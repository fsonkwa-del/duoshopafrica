import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  asRuntime,
  createDatabase,
  hashSessionToken,
  issueSessionToken,
  purgeStaleGuestCarts,
} from "@duoshop/database";
import { CART_COOKIE, SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const app = await createApp({ db, webOrigin });
const ids = { tenant: "", user: "", variants: [] as string[] };
const guestToken = () => randomBytes(32).toString("base64url");
let session = "";

const call = (
  method: "GET" | "POST",
  url: string,
  cookies: { session?: string; cart?: string },
  payload?: object,
) =>
  app.inject({
    method,
    url,
    headers: {
      cookie: [
        cookies.session ? `${SESSION_COOKIE}=${cookies.session}` : null,
        cookies.cart ? `${CART_COOKIE}=${cookies.cart}` : null,
      ]
        .filter(Boolean)
        .join("; "),
      ...(method === "POST" ? { origin: webOrigin } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const add = (
  cookies: { session?: string; cart?: string },
  variantId: string,
  quantity: number,
) => call("POST", "/v1/cart/items", cookies, { variantId, quantity });

before(async () => {
  const tenant = await db.tenant.create({
    data: { name: "TEST-guest-cart", status: "ACTIVE" },
  });
  ids.tenant = tenant.id;
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: "Atelier",
      deliveryFeeMinor: 1000n,
    },
  });
  const location = await db.inventoryLocation.create({
    data: { tenantId: tenant.id, storeId: store.id, name: "Principal" },
  });
  const product = await db.product.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      title: "Pagne",
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  for (const label of ["6 yards", "12 yards"]) {
    const variant = await db.productVariant.create({
      data: {
        tenantId: tenant.id,
        productId: product.id,
        sku: `G-${randomUUID().slice(0, 8)}`,
        label,
        priceMinor: 5000n,
        currency: "XAF",
      },
    });
    await db.stockLevel.create({
      data: {
        tenantId: tenant.id,
        variantId: variant.id,
        locationId: location.id,
        onHand: 50,
      },
    });
    ids.variants.push(variant.id);
  }
  const user = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  ids.user = user.id;
  const issued = issueSessionToken();
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: issued.tokenHash,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  session = issued.token;
});

after(async () => {
  await app.close();
  await db.cart.deleteMany({
    where: {
      OR: [
        { userId: ids.user },
        { items: { some: { variantId: { in: ids.variants } } } },
      ],
    },
  });
  await db.stockLevel.deleteMany({ where: { tenantId: ids.tenant } });
  await db.productVariant.deleteMany({ where: { tenantId: ids.tenant } });
  await db.product.deleteMany({ where: { tenantId: ids.tenant } });
  await db.inventoryLocation.deleteMany({ where: { tenantId: ids.tenant } });
  await db.store.deleteMany({ where: { tenantId: ids.tenant } });
  await db.tenant.delete({ where: { id: ids.tenant } });
  await db.session.deleteMany({ where: { userId: ids.user } });
  await db.user.delete({ where: { id: ids.user } });
  await db.$disconnect();
});

describe("guest cart (before any account)", () => {
  test("a visitor sees an empty cart and needs a cart token to add", async () => {
    const empty = await call("GET", "/v1/cart", {});
    assert.equal(empty.statusCode, 200);
    assert.equal(empty.json().itemCount, 0);
    const refused = await add({}, ids.variants[0] ?? "", 1);
    assert.equal(refused.statusCode, 400);
    assert.equal(refused.json().error, "cart_token_required");
  });

  test("a visitor fills a cart only they can read", async () => {
    const mine = guestToken();
    const added = await add({ cart: mine }, ids.variants[0] ?? "", 2);
    assert.equal(added.statusCode, 200, added.body);
    assert.equal(added.json().itemCount, 2);
    assert.equal(
      (await call("GET", "/v1/cart", { cart: mine })).json().itemCount,
      2,
    );
    assert.equal(
      (await call("GET", "/v1/cart", { cart: guestToken() })).json().itemCount,
      0,
    );
    // Seule l'empreinte du jeton est stockée ; sans contexte, la RLS ne montre rien.
    const stored = await db.cart.findUnique({
      where: { guestTokenHash: hashSessionToken(mine) },
    });
    assert.ok(stored);
    assert.equal(
      await asRuntime(db, {}, (tx) =>
        tx.cart.count({ where: { id: stored.id } }),
      ),
      0,
    );
  });

  test("signing in merges the visitor cart into the account cart, once", async () => {
    const [first, second] = ids.variants as [string, string];
    await add({ session }, first, 1);
    const guest = guestToken();
    await add({ cart: guest }, first, 2);
    await add({ cart: guest }, second, 1);
    // Deux requêtes simultanées juste après la connexion.
    const [a, b] = await Promise.all([
      call("GET", "/v1/cart", { session, cart: guest }),
      call("GET", "/v1/cart", { session, cart: guest }),
    ]);
    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200);
    const merged = await call("GET", "/v1/cart", { session });
    const lines = merged.json().groups[0].lines as {
      variantId: string;
      quantity: number;
    }[];
    assert.deepEqual(
      Object.fromEntries(lines.map((l) => [l.variantId, l.quantity])),
      { [first]: 3, [second]: 1 },
    );
    assert.equal(
      await db.cart.count({
        where: { guestTokenHash: hashSessionToken(guest) },
      }),
      0,
    );
    // Rejouer le cookie visiteur (vide désormais) ne change rien.
    assert.equal(
      (await call("GET", "/v1/cart", { session, cart: guest })).json()
        .itemCount,
      4,
    );
  });

  test("checkout also picks up articles added before signing in", async () => {
    const guest = guestToken();
    await add({ cart: guest }, ids.variants[1] ?? "", 2);
    const checkout = await call("GET", "/v1/checkout", {
      session,
      cart: guest,
    });
    assert.equal(checkout.statusCode, 200);
    assert.equal(checkout.json().cart.itemCount, 6);
  });

  test("abandoned visitor carts are purged after 30 days", async () => {
    const old = guestToken();
    await add({ cart: old }, ids.variants[0] ?? "", 1);
    await db.cart.update({
      where: { guestTokenHash: hashSessionToken(old) },
      data: { updatedAt: new Date(Date.now() - 31 * 86400_000) },
    });
    assert.ok((await purgeStaleGuestCarts(db)) >= 1);
    assert.equal(
      await db.cart.count({ where: { guestTokenHash: hashSessionToken(old) } }),
      0,
    );
  });
});

describe("abuse protection", () => {
  test("buyer writes are rate limited per client (60 per minute)", async () => {
    const limited = await createApp({ db, webOrigin });
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++)
      statuses.push(
        (
          await limited.inject({
            method: "POST",
            url: "/v1/cart/items",
            headers: { origin: webOrigin },
            payload: { variantId: randomUUID(), quantity: 1 },
          })
        ).statusCode,
      );
    await limited.close();
    assert.ok(statuses.slice(0, 60).every((s) => s !== 429));
    assert.equal(statuses[60], 429);
  });
});
