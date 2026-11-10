import {
  applyPaymentEvent,
  applyRetention,
  createDatabase,
  expireUnpaidOrders,
  issueMonthlyInvoices,
  pendingProviderPayments,
  purgeExpiredLoginAttempts,
  purgeStaleGuestCarts,
  recognizeDueCommissions,
  releaseExpiredReservations,
} from "@duoshop/database";
import { scannerFromEnv, storageFromEnv, vaultFromEnv } from "@duoshop/media";
import {
  collectionFromEnv,
  MERCHANT_FIELDS,
  openCredentials,
  providerForAccount,
  providersFromEnv,
  reconcilePayments,
} from "@duoshop/payments";
import { mailerFromEnv, sendPendingEmails } from "./email-job";
import { processPendingMedia } from "./media-job";

// Tâches réelles : purge des tentatives de connexion, libération des réservations de stock expirées,
// traitement des photos (seulement si un stockage objet est configuré), rapprochement des paiements
// en attente chez les prestataires qui le permettent.
const PURGE_EVERY_MS = 15 * 60_000;
const db = createDatabase();
// Chaque passage de tâche laisse un battement (lot 8) : la supervision alerte si une tâche
// s'arrête ou échoue. Écriture en arrière-plan : elle ne bloque jamais la tâche.
const log = (fields: Record<string, unknown>) => {
  console.info(
    JSON.stringify({
      service: "worker",
      timestamp: new Date().toISOString(),
      ...fields,
    }),
  );
  // Une tâche désactivée (pas de configuration) ne laisse pas de battement : pas de fausse alerte.
  if (typeof fields.job === "string" && fields.status !== "disabled")
    db.workerHeartbeat
      .upsert({
        where: { job: fields.job },
        create: {
          job: fields.job,
          lastRunAt: new Date(),
          lastStatus: fields.status === "failed" ? "failed" : "ok",
        },
        update: {
          lastRunAt: new Date(),
          lastStatus: fields.status === "failed" ? "failed" : "ok",
        },
      })
      .catch(() => undefined);
};
async function purge() {
  try {
    log({
      job: "purge_login_attempts",
      purged: await purgeExpiredLoginAttempts(db),
    });
  } catch (err) {
    log({ job: "purge_login_attempts", status: "failed", error: String(err) });
  }
  try {
    log({ job: "purge_guest_carts", purged: await purgeStaleGuestCarts(db) });
  } catch (err) {
    log({ job: "purge_guest_carts", status: "failed", error: String(err) });
  }
}

// Les réservations bloquent du stock vendable : cadence plus courte que la purge.
const RELEASE_EVERY_MS = 60_000;
async function releaseReservations() {
  try {
    log({
      job: "release_expired_reservations",
      released: await releaseExpiredReservations(db),
    });
  } catch (err) {
    log({
      job: "release_expired_reservations",
      status: "failed",
      error: String(err),
    });
  }
}

await purge();
await releaseReservations();
// Commandes non payées : expiration et restitution du stock (aucun paiement n'est encore possible).
async function expireOrders() {
  try {
    log({ job: "expire_unpaid_orders", expired: await expireUnpaidOrders(db) });
  } catch (err) {
    log({ job: "expire_unpaid_orders", status: "failed", error: String(err) });
  }
}
await expireOrders();
const orderTimer = setInterval(expireOrders, RELEASE_EVERY_MS);
const storage = storageFromEnv(process.env);
// Antivirus (lot 8) : sans clamd configuré, les photos ne sont pas analysées (signalé au démarrage).
const scan = scannerFromEnv(process.env);
if (!scan) log({ job: "antivirus", status: "disabled", reason: "no_clamav" });
const MEDIA_EVERY_MS = 30_000;
async function processMedia() {
  if (!storage) return;
  try {
    log({
      job: "process_media",
      ...(await processPendingMedia(db, storage, new Date(), scan)),
    });
  } catch (err) {
    log({ job: "process_media", status: "failed", error: String(err) });
  }
}
if (!storage)
  log({
    job: "process_media",
    status: "disabled",
    reason: "no_object_storage",
  });
await processMedia();
const mediaTimer = setInterval(processMedia, MEDIA_EVERY_MS);
// Paiements en attente : récents à chaque minute, anciens (jusqu'à 25 h) un passage sur quinze.
const providers = providersFromEnv(process.env);
// Mode direct (lot 3) : les paiements des vendeurs se relisent avec les identifiants de leur compte.
const collection = collectionFromEnv(process.env);
const direct = collection.mode === "DIRECT_SELLER";
async function accountProvider(accountId: string) {
  const [account] = await db.$queryRaw<
    {
      provider: string;
      mode: "SANDBOX" | "LIVE" | "MOCK";
      credentials: Buffer;
      keyVersion: number;
    }[]
  >`SELECT * FROM store_payment_account(${accountId}::uuid)`;
  if (!account) return undefined;
  return providerForAccount(
    account.provider,
    account.mode,
    openCredentials(
      Buffer.from(account.credentials),
      account.keyVersion,
      collection,
    ),
    process.env,
  );
}
let reconcileRuns = 0;
async function reconcile() {
  const includeOld = reconcileRuns++ % 15 === 0;
  try {
    log({
      job: "reconcile_payments",
      ...(await reconcilePayments(
        providers,
        {
          pending: (key, old) => pendingProviderPayments(db, key, old),
          apply: (key, event, accountId) =>
            applyPaymentEvent(db, key, event, undefined, accountId),
          ...(direct
            ? { accountProvider, accountKeys: Object.keys(MERCHANT_FIELDS) }
            : {}),
        },
        includeOld,
      )),
    });
  } catch (err) {
    log({ job: "reconcile_payments", status: "failed", error: String(err) });
  }
}
await reconcile();
const reconcileTimer = setInterval(reconcile, RELEASE_EVERY_MS);
// Conservation des données (lot 2) : une passe par jour, à blanc tant que le mode n'est pas ENFORCE.
const RETENTION_EVERY_MS = 24 * 3600_000;
async function retention() {
  try {
    log({ job: "apply_retention", ...(await applyRetention(db)) });
  } catch (err) {
    log({ job: "apply_retention", status: "failed", error: String(err) });
  }
}
await retention();
const retentionTimer = setInterval(retention, RETENTION_EVERY_MS);
// Comptabilité (lot 4) : commissions arrivées en fin de délai de réclamation, puis factures du
// mois précédent (une passe par heure, sans effet une fois le mois facturé).
async function accounting() {
  try {
    log({
      job: "recognize_commissions",
      recognized: await recognizeDueCommissions(db),
    });
  } catch (err) {
    log({ job: "recognize_commissions", status: "failed", error: String(err) });
  }
  try {
    log({ job: "issue_invoices", ...(await issueMonthlyInvoices(db)) });
  } catch (err) {
    log({ job: "issue_invoices", status: "failed", error: String(err) });
  }
}
await accounting();
const accountingTimer = setInterval(accounting, 3600_000);
// Pièces KYC dont la conservation est écoulée (lot 5) : objet effacé du coffre, puis marqué purgé.
const kyc = vaultFromEnv(process.env);
async function purgeKyc() {
  if (!kyc) return;
  let purged = 0;
  try {
    const due = await db.$queryRaw<{ id: string; objectKey: string }[]>`
      SELECT * FROM kyc_documents_to_purge(100)`;
    for (const d of due) {
      await kyc.vault.delete(d.objectKey);
      await db.$queryRaw`SELECT mark_kyc_purged(${d.id}::uuid)`;
      purged++;
    }
    log({ job: "purge_kyc_documents", purged });
  } catch (err) {
    log({
      job: "purge_kyc_documents",
      status: "failed",
      purged,
      error: String(err),
    });
  }
}
await purgeKyc();
const kycTimer = setInterval(purgeKyc, 24 * 3600_000);
// E-mails transactionnels (lot 8) : seulement si un serveur SMTP est configuré.
const mailer = mailerFromEnv(process.env);
async function emails() {
  if (!mailer) return;
  try {
    log({
      job: "send_emails",
      ...(await sendPendingEmails(db, mailer, process.env.WEB_ORIGIN ?? "")),
    });
  } catch (err) {
    log({ job: "send_emails", status: "failed", error: String(err) });
  }
}
if (!mailer) log({ job: "send_emails", status: "disabled", reason: "no_smtp" });
const emailTimer = setInterval(emails, 60_000);
const timer = setInterval(purge, PURGE_EVERY_MS);
const releaser = setInterval(releaseReservations, RELEASE_EVERY_MS);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    clearInterval(timer);
    clearInterval(releaser);
    clearInterval(orderTimer);
    clearInterval(mediaTimer);
    clearInterval(reconcileTimer);
    clearInterval(retentionTimer);
    clearInterval(accountingTimer);
    clearInterval(kycTimer);
    clearInterval(emailTimer);
    await db.$disconnect();
  });
