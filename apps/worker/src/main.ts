import {
  createDatabase,
  expireUnpaidOrders,
  purgeExpiredLoginAttempts,
  purgeStaleGuestCarts,
  releaseExpiredReservations,
} from "@duoshop/database";
import { storageFromEnv } from "@duoshop/media";
import { processPendingMedia } from "./media-job";

// Tâches réelles : purge des tentatives de connexion, libération des réservations de stock expirées,
// traitement des photos (seulement si un stockage objet est configuré).
// Aucun événement métier, paiement ni notification n'est traité.
const PURGE_EVERY_MS = 15 * 60_000;
const log = (fields: Record<string, unknown>) =>
  console.info(
    JSON.stringify({
      service: "worker",
      timestamp: new Date().toISOString(),
      ...fields,
    }),
  );

const db = createDatabase();
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
const MEDIA_EVERY_MS = 30_000;
async function processMedia() {
  if (!storage) return;
  try {
    log({ job: "process_media", ...(await processPendingMedia(db, storage)) });
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
const timer = setInterval(purge, PURGE_EVERY_MS);
const releaser = setInterval(releaseReservations, RELEASE_EVERY_MS);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    clearInterval(timer);
    clearInterval(releaser);
    clearInterval(orderTimer);
    clearInterval(mediaTimer);
    await db.$disconnect();
  });
