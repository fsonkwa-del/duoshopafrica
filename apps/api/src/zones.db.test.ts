import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase, issueSessionToken } from "@duoshop/database";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

// Frais de livraison par quartier (lot 7, ADR 0015) : quartiers gérés par l'ADMIN, tarifs par la
// boutique, devis serveur selon le quartier de l'adresse, montant figé sur la commande.
const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const app = await createApp({ db, webOrigin });
const ids = {
  tenants: [] as string[],
  users: [] as string[],
  zones: [] as string[],
};
const f = {
  storeId: "",
  slug: "",
  variantId: "",
  owner: "",
  catalog: "",
  buyer: "",
  admin: "",
  akwa: "",
  bonaberi: "",
  makepe: "",
};

async function user(platform?: "ADMIN") {
  const created = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  ids.users.push(created.id);
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
  method: "GET" | "POST",
  url: string,
  token: string | null,
  payload?: object,
) =>
  app.inject({
    method,
    url,
    headers: {
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(method === "POST" ? { origin: webOrigin } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const zoneId = async (slug: string) =>
  (await db.deliveryZone.findUniqueOrThrow({ where: { slug } })).id;

before(async () => {
  const tenant = await db.tenant.create({
    data: { name: "TEST-zones", status: "ACTIVE" },
  });
  ids.tenants.push(tenant.id);
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: "Boutique Zones",
      deliveryFeeMinor: 1500n,
    },
  });
  const location = await db.inventoryLocation.create({
    data: { tenantId: tenant.id, storeId: store.id, name: "Principal" },
  });
  const product = await db.product.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      title: "Poivre de Penja",
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  const variant = await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `Z-${randomUUID().slice(0, 8)}`,
      label: "500 g",
      priceMinor: 8000n,
      currency: "XAF",
    },
  });
  await db.stockLevel.create({
    data: {
      tenantId: tenant.id,
      variantId: variant.id,
      locationId: location.id,
      onHand: 20,
    },
  });
  const owner = await user();
  const catalog = await user();
  for (const [member, role] of [
    [owner, "OWNER"],
    [catalog, "CATALOG"],
  ] as const)
    await db.storeMember.create({
      data: { tenantId: tenant.id, storeId: store.id, userId: member.id, role },
    });
  Object.assign(f, {
    storeId: store.id,
    slug: store.slug,
    variantId: variant.id,
    owner: owner.token,
    catalog: catalog.token,
    buyer: (await user()).token,
    admin: (await user("ADMIN")).token,
    akwa: await zoneId("douala-akwa"),
    bonaberi: await zoneId("douala-bonaberi"),
    makepe: await zoneId("douala-makepe"),
  });
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  const userId = { in: ids.users };
  await db.orderItem.deleteMany({ where: { tenantId } });
  await db.sellerOrder.deleteMany({ where: { tenantId } });
  await db.order.deleteMany({ where: { buyerId: userId } });
  await db.address.deleteMany({ where: { userId } });
  await db.cartItem.deleteMany({ where: { cart: { userId } } });
  await db.cart.deleteMany({ where: { userId } });
  await db.storeZoneFee.deleteMany({ where: { tenantId } });
  await db.auditLog.deleteMany({ where: { tenantId } });
  await db.stockReservation.deleteMany({ where: { tenantId } });
  await db.stockLevel.deleteMany({ where: { tenantId } });
  await db.productVariant.deleteMany({ where: { tenantId } });
  await db.product.deleteMany({ where: { tenantId } });
  await db.inventoryLocation.deleteMany({ where: { tenantId } });
  await db.storeMember.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.configAudit.deleteMany({ where: { entityId: { in: ids.zones } } });
  await db.deliveryZone.deleteMany({ where: { id: { in: ids.zones } } });
  await db.platformMember.deleteMany({ where: { userId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("delivery fees by district", () => {
  test("districts are public; only the administration manages them", async () => {
    const list = await call("GET", "/v1/delivery-zones", null);
    assert.equal(list.statusCode, 200);
    assert.ok(
      list.json().zones.some((z: { name: string }) => z.name === "Bonabéri"),
    );
    const slug = `test-zone-${randomUUID().slice(0, 8)}`;
    const refused = await call("POST", "/v1/admin/delivery-zones", f.owner, {
      slug,
      city: "Douala",
      name: "Quartier test",
    });
    assert.equal(refused.statusCode, 404);
    const created = await call("POST", "/v1/admin/delivery-zones", f.admin, {
      slug,
      city: "Douala",
      name: "Quartier test",
    });
    assert.equal(created.statusCode, 201, created.body);
    ids.zones.push(created.json().id);
    const off = await call(
      "POST",
      `/v1/admin/delivery-zones/${created.json().id}`,
      f.admin,
      { active: false },
    );
    assert.equal(off.json().active, false);
    const after = await call("GET", "/v1/delivery-zones", null);
    assert.ok(
      !after.json().zones.some((z: { slug: string }) => z.slug === slug),
    );
  });

  test("the owner sets fees by district; other roles cannot", async () => {
    const fees = [
      { zoneId: f.akwa, feeMinor: "1000" },
      { zoneId: f.bonaberi, feeMinor: null },
    ];
    const url = `/v1/stores/${f.storeId}/zone-fees`;
    assert.equal(
      (await call("POST", url, f.catalog, { fees })).statusCode,
      403,
    );
    assert.equal(
      (
        await call("POST", url, f.owner, {
          fees: [{ zoneId: f.akwa, feeMinor: "dix" }],
        })
      ).statusCode,
      400,
    );
    const saved = await call("POST", url, f.owner, { fees });
    assert.equal(saved.statusCode, 200, saved.body);
    const store = await call("GET", `/v1/stores/${f.storeId}`, f.owner);
    assert.deepEqual(
      store
        .json()
        .zoneFees.sort((a: { zoneId: string }, b: { zoneId: string }) =>
          a.zoneId.localeCompare(b.zoneId),
        ),
      fees.sort((a, b) => a.zoneId.localeCompare(b.zoneId)),
    );
  });

  test("the quote follows the address district; a district not served is refused", async () => {
    await call("POST", "/v1/cart/items", f.buyer, {
      variantId: f.variantId,
      quantity: 1,
    });
    const address = async (zone: string | undefined, district?: string) => {
      const res = await call("POST", "/v1/addresses", f.buyer, {
        label: "Maison",
        recipientName: "Awa Ngono",
        phone: "699 12 34 56",
        city: "Douala",
        landmark: "Derrière la pharmacie",
        ...(zone ? { zoneId: zone } : {}),
        ...(district ? { district } : {}),
      });
      return res;
    };
    const unknown = await address(randomUUID());
    assert.equal(unknown.json().error, "zone_unknown");
    assert.equal((await address(undefined)).json().error, "invalid_request");
    const akwa = await address(f.akwa);
    assert.equal(akwa.statusCode, 201, akwa.body);
    // Sans précision, le quartier saisi reprend le nom de la zone choisie.
    assert.equal(akwa.json().district, "Akwa");
    assert.deepEqual(akwa.json().zone, { id: f.akwa, name: "Akwa" });
    const bonaberi = (await address(f.bonaberi)).json().id;
    const makepe = (await address(f.makepe, "Makepe Missoké")).json().id;
    const other = (await address(undefined, "Village")).json().id;

    const options = await call("GET", "/v1/checkout", f.buyer);
    assert.deepEqual(options.json().options[0].homeDelivery, {
      fee: { amountMinor: "1000", currency: "XAF" },
      byZone: true,
    });
    const quote = (addressId: string) =>
      call("POST", "/v1/checkout/quote", f.buyer, {
        deliveries: [{ storeSlug: f.slug, method: "HOME_DELIVERY" }],
        addressId,
      });
    assert.equal(
      (await quote(akwa.json().id)).json().deliveryTotal.amountMinor,
      "1000",
    );
    // Quartier sans ligne de tarif, ou adresse sans quartier : tarif « toutes zones ».
    assert.equal(
      (await quote(makepe)).json().deliveryTotal.amountMinor,
      "1500",
    );
    assert.equal((await quote(other)).json().deliveryTotal.amountMinor, "1500");
    const refused = await quote(bonaberi);
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, "zone_not_served");

    const placed = await call("POST", "/v1/orders", f.buyer, {
      idempotencyKey: randomUUID().replaceAll("-", ""),
      deliveries: [{ storeSlug: f.slug, method: "HOME_DELIVERY" }],
      addressId: akwa.json().id,
      expectedTotalMinor: "9000",
    });
    assert.equal(placed.statusCode, 201, placed.body);
    // Le tarif change ensuite : la commande garde celui du jour.
    await call("POST", `/v1/stores/${f.storeId}/zone-fees`, f.owner, {
      fees: [{ zoneId: f.akwa, feeMinor: "3000" }],
    });
    const order = await call("GET", `/v1/orders/${placed.json().id}`, f.buyer);
    assert.equal(order.json().deliveryTotal.amountMinor, "1000");
  });
});
