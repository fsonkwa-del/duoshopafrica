import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createDatabase } from "@duoshop/database";
import { type Mailer, sendPendingEmails } from "./email-job";

// Lot 8 (ADR 0016) : e-mails transactionnels. Une notification n'est envoyée qu'une fois, jamais
// à une adresse anonymisée ou de test, et le message ne contient que l'événement et un lien.
const db = createDatabase();
const users: string[] = [];
after(async () => {
  await db.notification.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

test("order notifications are emailed once, minimal, never to anonymised or test addresses", async () => {
  const real = await db.user.create({
    data: { email: `${randomUUID()}@exemple.cm` },
  });
  const fake = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  users.push(real.id, fake.id);
  const orderId = randomUUID();
  for (const u of [real, fake])
    await db.notification.create({
      data: {
        userId: u.id,
        kind: "order_paid",
        orderId,
        data: { store: "Boutique" },
      },
    });
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  const first = await sendPendingEmails(db, mailer, "https://shop.example");
  const mine = sent.filter((m) => m.to === real.email);
  assert.equal(mine.length, 1);
  assert.ok(!sent.some((m) => m.to === fake.email));
  assert.match(
    mine[0]?.text ?? "",
    new RegExp(`https://shop.example/fr/orders/${orderId}`),
  );
  assert.ok(!(mine[0]?.text ?? "").includes("Boutique"));
  assert.ok(first.sent >= 1);
  // Deuxième passage : rien n'est renvoyé.
  await sendPendingEmails(db, mailer, "https://shop.example");
  assert.equal(sent.filter((m) => m.to === real.email).length, 1);
  assert.equal(
    await db.notification.count({
      where: { userId: { in: users }, emailedAt: null },
    }),
    0,
  );
});
