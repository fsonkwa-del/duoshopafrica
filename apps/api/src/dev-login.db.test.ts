import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { createDatabase, hashSessionToken } from "@duoshop/database";
import { createApp } from "./app";
import { DEMO_PROFILES } from "./dev-login";

const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const off = await createApp({ db, webOrigin });
const on = await createApp({ db, webOrigin, devLogin: true });
const tokens: string[] = [];

after(async () => {
  await off.close();
  await on.close();
  await db.session.deleteMany({
    where: { tokenHash: { in: tokens.map(hashSessionToken) } },
  });
  await db.$disconnect();
});

const issue = (app: typeof on, profile: string, origin = webOrigin) =>
  app.inject({
    method: "POST",
    url: "/v1/dev/sessions",
    headers: { origin },
    payload: { profile },
  });

describe("demo sign-in (development only)", () => {
  test("does not exist unless explicitly enabled", async () => {
    assert.equal((await issue(off, "buyer")).statusCode, 404);
    const login = await off.inject({ url: "/v1/auth/login?locale=fr" });
    assert.equal(login.statusCode, 503);
  });

  test("sign-in without an identity provider leads to the demo page", async () => {
    const login = await on.inject({
      url: "/v1/auth/login?locale=en&returnTo=/en/cart",
    });
    assert.equal(login.statusCode, 302);
    assert.equal(login.headers.location, "/en/dev-login?returnTo=%2Fen%2Fcart");
  });

  test("issues sessions for fixed demo profiles only, from the site origin", async () => {
    assert.equal((await issue(on, "root")).statusCode, 400);
    assert.equal(
      (await issue(on, "buyer", "https://evil.example")).statusCode,
      403,
    );
    const admin = await issue(on, "admin");
    assert.equal(admin.statusCode, 200);
    const token = admin.json().token as string;
    tokens.push(token);
    const session = await db.session.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: { include: { platform: true } } },
    });
    assert.equal(session.user.email, DEMO_PROFILES.admin);
    assert.equal(session.mfa, true);
    assert.equal(session.user.platform?.role, "ADMIN");
    const buyer = await issue(on, "buyer");
    tokens.push(buyer.json().token);
    const buyerSession = await db.session.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(buyer.json().token) },
    });
    assert.equal(buyerSession.mfa, false);
  });
});
