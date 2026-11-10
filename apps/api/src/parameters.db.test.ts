import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";
import {
  asRuntime,
  createDatabase,
  issueSessionToken,
} from "@duoshop/database";
import type { ParametersDTO } from "@duoshop/types";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

// Paramètres réglementaires datés (ADR 0008) : deux personnes, jamais rétroactifs, sans chevauchement.
// Les propositions prennent effet dans 10 ans : les autres suites ne voient jamais ces valeurs.
const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const app = await createApp({ db, webOrigin });
const users: string[] = [];
const proposals: string[] = [];
const KEY = "claims.window";
const FUTURE = new Date(Date.now() + 10 * 365 * 86400_000);
const later = (ms: number) => new Date(FUTURE.getTime() + ms).toISOString();

async function user(platform?: "ADMIN" | "SUPPORT" | "FINANCE") {
  const created = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  users.push(created.id);
  if (platform)
    await db.platformMember.create({
      data: { userId: created.id, role: platform },
    });
  const { token, tokenHash } = issueSessionToken();
  await db.session.create({
    data: {
      userId: created.id,
      tokenHash,
      mfa: Boolean(platform),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return { id: created.id, token };
}
const call = (
  token: string,
  method: "GET" | "POST",
  url: string,
  payload?: object,
) =>
  app.inject({
    method,
    url,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      ...(method === "POST" ? { origin: webOrigin } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const propose = async (token: string, body: Record<string, unknown>) => {
  const res = await call(token, "POST", "/v1/admin/parameters", {
    key: KEY,
    validated: false,
    ...body,
  });
  if (res.statusCode === 201) proposals.push(res.json().id);
  return res;
};
const valueAt = async (at: string) => {
  const [row] = await db.$queryRaw<{ value: string }[]>`
    SELECT param_value(${KEY}, ${at}::timestamptz) AS value`;
  return row?.value;
};

const admin = await user("ADMIN");
const admin2 = await user("ADMIN");
const finance = await user("FINANCE");
const support = await user("SUPPORT");
const buyer = await user();

after(async () => {
  await db.configAudit.deleteMany({ where: { entityId: { in: proposals } } });
  await db.regulatoryParameter.deleteMany({ where: { id: { in: proposals } } });
  // Période d'origine rouverte : l'approbation l'avait close à la date future.
  await db.regulatoryParameter.updateMany({
    where: { key: KEY, proposedBy: null },
    data: { effectiveTo: null },
  });
  await db.session.deleteMany({ where: { userId: { in: users } } });
  await db.platformMember.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await app.close();
  await db.$disconnect();
});

describe("regulatory parameters", () => {
  test("seeded values replace the former constants, all still to validate", async () => {
    const res = await call(admin.token, "GET", "/v1/admin/parameters");
    assert.equal(res.statusCode, 200);
    const body = res.json() as ParametersDTO;
    const current = Object.fromEntries(
      body.definitions.map((d) => [d.key, d.current?.value]),
    );
    assert.equal(current["order.payment_window"], "30 minutes");
    // Portée à 15 minutes au lot 3 (nouvelle période, la valeur d'origine est close).
    assert.equal(current["payment.attempt_window"], "15 minutes");
    assert.equal(current["claims.window"], "7 days");
    assert.equal(current["guest_cart.retention"], "30 days");
    assert.ok(
      // Identité de la plateforme (lot 4) : aucune valeur tant qu'elle n'est pas saisie.
      body.definitions.every(
        (d) => !d.current || d.current.validationStatus === "A_VALIDER",
      ),
    );
    assert.equal(await valueAt(new Date().toISOString()), "7 days");
  });

  test("only ADMIN and FINANCE read them; others never see the page", async () => {
    assert.equal(
      (await call(buyer.token, "GET", "/v1/admin/parameters")).statusCode,
      404,
    );
    assert.equal(
      (await call(support.token, "GET", "/v1/admin/parameters")).statusCode,
      403,
    );
    assert.equal(
      (await call(finance.token, "GET", "/v1/admin/parameters")).statusCode,
      200,
    );
  });

  test("a proposal is checked: owner role, value, bounds, date, basis", async () => {
    const refused = async (
      token: string,
      body: Record<string, unknown>,
      status: number,
      error: string,
    ) => {
      const res = await propose(token, body);
      assert.equal(res.statusCode, status, res.body);
      assert.equal(res.json().error, error);
    };
    const from = later(0);
    await refused(
      finance.token,
      { value: "3 days", effectiveFrom: from },
      403,
      "parameter_forbidden",
    );
    await refused(
      admin.token,
      { value: "trois jours", effectiveFrom: from },
      400,
      "parameter_invalid",
    );
    await refused(
      admin.token,
      { value: "2 hours", effectiveFrom: from },
      400,
      "parameter_invalid",
    );
    await refused(
      admin.token,
      {
        value: "3 days",
        effectiveFrom: new Date(Date.now() - 3600_000).toISOString(),
      },
      400,
      "parameter_retroactive",
    );
    await refused(
      admin.token,
      { value: "3 days", effectiveFrom: from, validated: true },
      400,
      "parameter_basis_required",
    );
    await refused(
      admin.token,
      { key: "unknown.key", value: "1", effectiveFrom: from },
      404,
      "parameter_unknown",
    );
  });

  test("a second person approves; the former period ends where the new one starts", async () => {
    const from = later(0);
    const res = await propose(admin.token, {
      value: "3 days",
      effectiveFrom: from,
      legalBasis: "Test : avis fictif n° 1 du juriste",
      validated: true,
    });
    assert.equal(res.statusCode, 201, res.body);
    const id = res.json().id as string;
    const decide = (token: string, body: object) =>
      call(token, "POST", `/v1/admin/parameters/${id}/decide`, body);

    // Pas encore approuvée : sans effet.
    assert.equal(await valueAt(later(86400_000)), "7 days");
    const self = await decide(admin.token, { approve: true });
    assert.equal(self.statusCode, 403);
    assert.equal(self.json().error, "same_person");
    const noReason = await decide(finance.token, { approve: false });
    assert.equal(noReason.statusCode, 400);
    assert.equal(noReason.json().error, "reason_required");

    const ok = await decide(finance.token, { approve: true });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(
      (await decide(admin2.token, { approve: true })).statusCode,
      409,
    );

    assert.equal(await valueAt(later(-1000)), "7 days");
    assert.equal(await valueAt(later(1000)), "3 days");
    const view = (
      await call(admin.token, "GET", "/v1/admin/parameters")
    ).json() as ParametersDTO;
    const approved = view.history.find((v) => v.id === id);
    assert.equal(approved?.validationStatus, "VALIDE");
    // Aujourd'hui, la valeur d'origine reste en vigueur.
    assert.equal(
      view.definitions.find((d) => d.key === KEY)?.current?.value,
      "7 days",
    );
    const audit = await db.configAudit.findMany({ where: { entityId: id } });
    assert.deepEqual(audit.map((a) => a.action).sort(), ["approve", "propose"]);
  });

  test("a value starting before an approved one cannot be approved; a rejection keeps its reason", async () => {
    const early = await propose(admin.token, {
      value: "5 days",
      effectiveFrom: later(-86400_000),
    });
    assert.equal(early.statusCode, 201);
    const conflict = await call(
      admin2.token,
      "POST",
      `/v1/admin/parameters/${early.json().id}/decide`,
      { approve: true },
    );
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error, "conflict");
    const rejected = await call(
      admin2.token,
      "POST",
      `/v1/admin/parameters/${early.json().id}/decide`,
      { approve: false, reason: "Antérieure à la valeur approuvée" },
    );
    assert.equal(rejected.statusCode, 200);
    assert.equal(await valueAt(later(-1000)), "7 days");
  });

  test("the runtime role cannot write parameters directly", async () => {
    await assert.rejects(
      asRuntime(
        db,
        { userId: admin.id },
        (tx) =>
          tx.$executeRaw`UPDATE "RegulatoryParameter" SET "value" = '"1 day"' WHERE "key" = ${KEY}`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      asRuntime(
        db,
        { userId: admin.id },
        (tx) =>
          tx.$executeRaw`INSERT INTO "RegulatoryParameter" ("id", "key", "value", "effectiveFrom", "approvedAt")
          VALUES (gen_random_uuid(), ${KEY}, '"1 day"', now(), now())`,
      ),
      /permission denied/,
    );
  });

  test("two approved periods of the same key never overlap, even for the owner", async () => {
    await assert.rejects(
      db.$executeRaw`INSERT INTO "RegulatoryParameter" ("id", "key", "value", "effectiveFrom", "approvedAt")
        VALUES (gen_random_uuid(), ${KEY}, '"2 days"', now(), now())`,
      /RegulatoryParameter_no_overlap/,
    );
  });
});
