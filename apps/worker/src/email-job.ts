import type { Database } from "@duoshop/database";
import { messages } from "@duoshop/i18n";
import { createTransport } from "nodemailer";

// Lot 8 (ADR 0016) : notifications de commande envoyées aussi par e-mail transactionnel, quand un
// serveur SMTP est configuré. Le message ne contient que l'événement, la référence et un lien :
// ni adresse, ni téléphone, ni contenu de commande (minimisation, flux sortant déclaré).
export interface Mailer {
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}

export function mailerFromEnv(
  env: Record<string, string | undefined>,
): Mailer | undefined {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return undefined;
  const transport = createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT ?? "587"),
    secure: env.SMTP_PORT === "465",
    requireTLS: env.SMTP_PORT !== "465",
    ...(env.SMTP_USER
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } }
      : {}),
  });
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from: env.SMTP_FROM, to, subject, text });
    },
  };
}

// Adresses jamais contactées : anonymisées (lot 2) et réservées aux tests.
const UNDELIVERABLE = /@(anonymized|example)\.invalid$/;

export async function sendPendingEmails(
  db: Database,
  mailer: Mailer,
  siteOrigin: string,
  limit = 50,
): Promise<{ sent: number; failed: number }> {
  const fr = messages.fr.notifications.kinds as Record<string, string>;
  const en = messages.en.notifications.kinds as Record<string, string>;
  // Seulement les notifications récentes : pas de rattrapage massif à l'activation du SMTP.
  const pending = await db.notification.findMany({
    where: {
      emailedAt: null,
      createdAt: { gt: new Date(Date.now() - 24 * 3600_000) },
    },
    include: { user: { select: { email: true, anonymizedAt: true } } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const result = { sent: 0, failed: 0 };
  for (const n of pending) {
    // Marquée d'abord : un envoi n'est jamais répété, même si la suite échoue.
    await db.notification.update({
      where: { id: n.id },
      data: { emailedAt: new Date() },
    });
    if (n.user.anonymizedAt || UNDELIVERABLE.test(n.user.email)) continue;
    const reference = n.orderId ? n.orderId.slice(0, 8).toUpperCase() : "";
    const link = n.orderId
      ? `${siteOrigin}/fr/orders/${n.orderId}`
      : `${siteOrigin}/fr/notifications`;
    try {
      await mailer.send({
        to: n.user.email,
        subject: `DuoShopAfrica — ${fr[n.kind] ?? n.kind} ${reference}`.trim(),
        text: [
          `${fr[n.kind] ?? n.kind} ${reference}`.trim(),
          link,
          "",
          `${en[n.kind] ?? n.kind} ${reference}`.trim(),
        ].join("\n"),
      });
      result.sent++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
