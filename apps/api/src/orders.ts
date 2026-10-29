import { createHash, randomUUID } from "node:crypto";
import { businessDefaults } from "@duoshop/config";
import {
  asRuntime,
  type Database,
  hashSessionToken,
  type ScopedTx,
} from "@duoshop/database";
import {
  canOpenClaim,
  claimHoldsPayout,
  normalizeCameroonPhone,
  ORDER_PAYMENT_WINDOW_MS,
  parsePriceMinor,
  roundCoordinate,
} from "@duoshop/domain";
import {
  type AddressDTO,
  CART_COOKIE,
  type DeliveryContactDTO,
  type DeliveryMethodDTO,
  type DeliveryOptionsDTO,
  type OrderDTO,
  type QuoteDTO,
  type SellerOrderDTO,
} from "@duoshop/types";
import type { FastifyInstance, FastifyReply } from "fastify";
import { buildCart, mergeGuestCart } from "./cart";
import { claimInclude, claimView } from "./claims";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
  writeLimit,
} from "./guards";
import { paymentView } from "./payments";
import { readCookie } from "./session";
import { inStore } from "./store-scope";

const uuid = { type: "string", format: "uuid" } as const;
const refusals = {
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
} as const;
// Succès sérialisé tel quel (DTO typés côté TypeScript, montants déjà en chaînes).
const anyObject = { type: "object", additionalProperties: true } as const;
const money = (amount: bigint, currency: string) => ({
  amountMinor: amount.toString(),
  currency,
});

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "P2002"
  );
}
// Interrompt la transaction (et annule toutes les réservations déjà faites) avec un code métier.
class CheckoutRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

interface DeliveryChoice {
  storeSlug: string;
  method: DeliveryMethodDTO;
}

// ---------- Devis : recalculé côté serveur à partir du panier, jamais fourni par le client ----------
async function deliveryOptions(tx: ScopedTx, slugs: string[]) {
  return tx.store.findMany({
    where: { slug: { in: slugs } },
    select: {
      id: true,
      tenantId: true,
      name: true,
      slug: true,
      deliveryFeeMinor: true,
      pickupEnabled: true,
      pickupInstructions: true,
    },
  });
}

async function computeQuote(
  tx: ScopedTx,
  userId: string,
  choices: DeliveryChoice[],
  addressId: string | undefined,
) {
  const cart = await buildCart(tx, { userId });
  if (cart.groups.length === 0) throw new CheckoutRefusal("cart_empty");
  if (
    cart.unavailable.length > 0 ||
    cart.groups.some((g) => g.lines.some((l) => l.status !== "ok"))
  )
    throw new CheckoutRefusal("cart_needs_attention");
  const stores = await deliveryOptions(
    tx,
    cart.groups.map((g) => g.store.slug),
  );
  const address = addressId
    ? await tx.address.findFirst({ where: { id: addressId, archivedAt: null } })
    : null;
  if (addressId && !address) throw new CheckoutRefusal("address_not_found");
  let itemsTotal = 0n;
  let deliveryTotal = 0n;
  const groups = cart.groups.map((group) => {
    const store = stores.find((s) => s.slug === group.store.slug);
    const choice = choices.find((c) => c.storeSlug === group.store.slug);
    if (!store || !choice) throw new CheckoutRefusal("delivery_choice_missing");
    let fee = 0n;
    if (choice.method === "HOME_DELIVERY") {
      if (store.deliveryFeeMinor === null)
        throw new CheckoutRefusal("delivery_unavailable");
      if (!address) throw new CheckoutRefusal("address_required");
      fee = store.deliveryFeeMinor;
    } else if (!store.pickupEnabled)
      throw new CheckoutRefusal("pickup_unavailable");
    const items = BigInt(group.subtotal.amountMinor);
    itemsTotal += items;
    deliveryTotal += fee;
    return { group, store, method: choice.method, items, fee };
  });
  if (choices.some((c) => !groups.some((g) => g.store.slug === c.storeSlug)))
    throw new CheckoutRefusal("delivery_choice_unknown_store");
  return {
    cart,
    groups,
    address,
    itemsTotal,
    deliveryTotal,
    total: itemsTotal + deliveryTotal,
  };
}

function quoteView(quote: Awaited<ReturnType<typeof computeQuote>>): QuoteDTO {
  const currency = quote.cart.currency;
  return {
    groups: quote.groups.map((g) => ({
      store: g.group.store,
      method: g.method,
      itemsTotal: money(g.items, currency),
      deliveryFee: money(g.fee, currency),
    })),
    itemsTotal: money(quote.itemsTotal, currency),
    deliveryTotal: money(quote.deliveryTotal, currency),
    total: money(quote.total, currency),
  };
}

// ---------- Vues ----------
type AddressRow = Awaited<ReturnType<ScopedTx["address"]["findMany"]>>[number];
function addressView(a: AddressRow): AddressDTO {
  return {
    id: a.id,
    label: a.label,
    recipientName: a.recipientName,
    phone: a.phone,
    city: a.city,
    district: a.district,
    landmark: a.landmark,
    details: a.details,
    hasCoordinates: a.latitude !== null,
  };
}
const orderInclude = {
  sellerOrders: {
    orderBy: { createdAt: "asc" },
    include: {
      items: { orderBy: { title: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      // Code de remise : la RLS ne le rend qu'à l'acheteur.
      handover: true,
      claims: { orderBy: { createdAt: "desc" }, include: claimInclude },
    },
  },
  payments: { orderBy: { createdAt: "desc" } },
} as const;
type OrderRow = Awaited<ReturnType<ScopedTx["order"]["findMany"]>>[number] & {
  sellerOrders: (Awaited<
    ReturnType<ScopedTx["sellerOrder"]["findMany"]>
  >[number] & {
    items: Awaited<ReturnType<ScopedTx["orderItem"]["findMany"]>>;
    events?: Awaited<ReturnType<ScopedTx["fulfilmentEvent"]["findMany"]>>;
    handover?: { code: string } | null;
    claims?: Parameters<typeof claimView>[0][];
  })[];
  payments: Awaited<ReturnType<ScopedTx["payment"]["findMany"]>>;
};
function sellerOrderView(
  so: OrderRow["sellerOrders"][number],
  currency: string,
): SellerOrderDTO {
  return {
    id: so.id,
    storeName: so.storeName,
    status: so.status,
    fulfilmentStatus: so.fulfilmentStatus,
    fulfilmentVersion: so.fulfilmentVersion,
    deliveredAt: so.deliveredAt?.toISOString() ?? null,
    events: (so.events ?? []).map((e) => ({
      status: e.status,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
    handoverCode:
      so.fulfilmentStatus !== "DELIVERED" ? (so.handover?.code ?? null) : null,
    claimable:
      canOpenClaim({
        fulfilmentStatus: so.fulfilmentStatus,
        deliveredAt: so.deliveredAt,
        now: new Date(),
      }) && !(so.claims ?? []).some((c) => claimHoldsPayout(c.status)),
    claims: (so.claims ?? []).map(claimView),
    deliveryMethod: so.deliveryMethod,
    deliveryFee: money(so.deliveryFeeMinor, currency),
    itemsTotal: money(so.itemsTotalMinor, currency),
    pickupInstructions: so.pickupInstructions,
    items: so.items.map((i) => ({
      id: i.id,
      title: i.title,
      label: i.label,
      quantity: i.quantity,
      unitPrice: money(i.unitPriceMinor, i.currency),
      lineTotal: money(i.lineTotalMinor, i.currency),
    })),
  };
}
function orderView(o: OrderRow): OrderDTO {
  return {
    id: o.id,
    status: o.status,
    itemsTotal: money(o.itemsTotalMinor, o.currency),
    deliveryTotal: money(o.deliveryTotalMinor, o.currency),
    total: money(o.totalMinor, o.currency),
    expiresAt: o.expiresAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    sellers: o.sellerOrders.map((so) => sellerOrderView(so, o.currency)),
    payments: o.payments.map(paymentView),
  };
}

function contactOf(value: unknown): DeliveryContactDTO | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const text = (k: string) =>
    typeof v[k] === "string" ? (v[k] as string) : "";
  return {
    recipientName: text("recipientName"),
    phone: text("phone"),
    city: text("city"),
    district: text("district"),
    landmark: text("landmark"),
    details: text("details") || null,
  };
}

const deliveriesSchema = {
  type: "array",
  minItems: 1,
  maxItems: 20,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["storeSlug", "method"],
    properties: {
      storeSlug: { type: "string", minLength: 1, maxLength: 100 },
      method: { enum: ["HOME_DELIVERY", "PICKUP"] },
    },
  },
} as const;

async function refuse(reply: FastifyReply, err: unknown) {
  if (err instanceof CheckoutRefusal)
    return reply.code(409).send({ error: err.code });
  throw err;
}

export async function orderRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;

  // ---------- Options de remise de la boutique (vendeur) ----------
  app.post(
    "/v1/stores/:storeId/fulfilment",
    {
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["deliveryFeeMinor", "pickupEnabled", "expectedVersion"],
          properties: {
            // null : pas de livraison à domicile proposée.
            deliveryFeeMinor: {
              anyOf: [
                { type: "string", pattern: "^[0-9]{1,9}$" },
                { type: "null" },
              ],
            },
            pickupEnabled: { type: "boolean" },
            pickupInstructions: { type: "string", maxLength: 300 },
            expectedVersion: { type: "integer", minimum: 0 },
          },
        },
        response: refusals,
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId } = request.params as { storeId: string };
      const body = request.body as {
        deliveryFeeMinor: string | null;
        pickupEnabled: boolean;
        pickupInstructions?: string;
        expectedVersion: number;
      };
      // Livraison gratuite autorisée (0) ; parsePriceMinor refuse 0, d'où ce cas explicite.
      const fee =
        body.deliveryFeeMinor === null
          ? null
          : body.deliveryFeeMinor === "0"
            ? 0n
            : parsePriceMinor(body.deliveryFeeMinor);
      if (body.deliveryFeeMinor !== null && fee === null)
        return reply.code(400).send({ error: "invalid_request" });
      const result = await inStore(
        db,
        principal,
        storeId,
        "store:configure",
        async (tx, ctx) => {
          const { count } = await tx.store.updateMany({
            where: { id: storeId, version: body.expectedVersion },
            data: {
              deliveryFeeMinor: fee,
              pickupEnabled: body.pickupEnabled,
              pickupInstructions: body.pickupInstructions?.trim() || null,
              version: { increment: 1 },
            },
          });
          if (count !== 1) return false;
          await tx.auditLog.create({
            data: {
              tenantId: ctx.tenantId,
              actorId: ctx.userId,
              action: "store.fulfilment.update",
              resourceId: storeId,
              requestId: request.id,
              detail: {
                deliveryFeeMinor: fee?.toString() ?? null,
                pickupEnabled: body.pickupEnabled,
              },
            },
          });
          return true;
        },
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      if (!result.value)
        return reply.code(409).send({ error: "stale_version" });
      return { version: body.expectedVersion + 1 };
    },
  );

  // ---------- Adresses de l'acheteur ----------
  app.get(
    "/v1/addresses",
    { schema: { response: { 401: error } } },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const rows = await asRuntime(db, { userId: principal.userId }, (tx) =>
        tx.address.findMany({
          where: { archivedAt: null },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      );
      return { addresses: rows.map(addressView) };
    },
  );

  app.post(
    "/v1/addresses",
    {
      config: writeLimit,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "label",
            "recipientName",
            "phone",
            "city",
            "district",
            "landmark",
          ],
          properties: {
            label: { type: "string", minLength: 1, maxLength: 40 },
            recipientName: { type: "string", minLength: 2, maxLength: 80 },
            phone: { type: "string", minLength: 8, maxLength: 20 },
            city: { type: "string", minLength: 2, maxLength: 60 },
            district: { type: "string", minLength: 2, maxLength: 80 },
            // Le repère est la clé de la livraison à Douala : obligatoire.
            landmark: { type: "string", minLength: 3, maxLength: 160 },
            details: { type: "string", maxLength: 200 },
            latitude: { type: "number", minimum: -90, maximum: 90 },
            longitude: { type: "number", minimum: -180, maximum: 180 },
          },
        },
        response: { 201: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const body = request.body as Record<string, string | number | undefined>;
      const phone = normalizeCameroonPhone(String(body.phone));
      const hasLat = body.latitude !== undefined;
      if (!phone || hasLat !== (body.longitude !== undefined))
        return reply.code(400).send({ error: "invalid_request" });
      const latitude = hasLat
        ? roundCoordinate(Number(body.latitude), 90)
        : null;
      const longitude = hasLat
        ? roundCoordinate(Number(body.longitude), 180)
        : null;
      const userId = principal.userId;
      const created = await asRuntime(db, { userId }, async (tx) => {
        if ((await tx.address.count({ where: { archivedAt: null } })) >= 20)
          return null;
        return tx.address.create({
          data: {
            userId,
            label: String(body.label).trim(),
            recipientName: String(body.recipientName).trim(),
            phone,
            city: String(body.city).trim(),
            district: String(body.district).trim(),
            landmark: String(body.landmark).trim(),
            details: body.details ? String(body.details).trim() : null,
            latitude,
            longitude,
          },
        });
      });
      if (!created) return reply.code(409).send({ error: "address_limit" });
      return reply.code(201).send(addressView(created));
    },
  );

  app.post(
    "/v1/addresses/:addressId/archive",
    {
      schema: {
        params: {
          type: "object",
          required: ["addressId"],
          properties: { addressId: uuid },
        },
        response: { 204: { type: "null" }, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { addressId } = request.params as { addressId: string };
      // Archivage (pas de suppression) : une commande passée garde sa copie figée de l'adresse.
      const { count } = await asRuntime(
        db,
        { userId: principal.userId },
        (tx) =>
          tx.address.updateMany({
            where: { id: addressId, archivedAt: null },
            data: { archivedAt: new Date() },
          }),
      );
      return count === 1
        ? reply.code(204).send()
        : reply.code(404).send({ error: "not_found" });
    },
  );

  // ---------- Checkout ----------
  app.get(
    "/v1/checkout",
    { schema: { response: { 401: error } } },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      // Articles ajoutés avant la connexion : rejoignent le panier du compte.
      const guest = readCookie(request, CART_COOKIE);
      if (guest)
        await mergeGuestCart(db, principal.userId, hashSessionToken(guest));
      return asRuntime(db, { userId: principal.userId }, async (tx) => {
        const cart = await buildCart(tx, { userId: principal.userId });
        const stores = await deliveryOptions(
          tx,
          cart.groups.map((g) => g.store.slug),
        );
        const options: DeliveryOptionsDTO[] = cart.groups.map((group) => {
          const store = stores.find((s) => s.slug === group.store.slug);
          return {
            store: group.store,
            homeDelivery:
              store?.deliveryFeeMinor != null
                ? { fee: money(store.deliveryFeeMinor, cart.currency) }
                : null,
            pickup: store?.pickupEnabled
              ? { instructions: store.pickupInstructions }
              : null,
          };
        });
        const addresses = await tx.address.findMany({
          where: { archivedAt: null },
          orderBy: { createdAt: "desc" },
          take: 20,
        });
        return { cart, options, addresses: addresses.map(addressView) };
      });
    },
  );

  app.post(
    "/v1/checkout/quote",
    {
      config: writeLimit,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["deliveries"],
          properties: { deliveries: deliveriesSchema, addressId: uuid },
        },
        response: refusals,
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const body = request.body as {
        deliveries: DeliveryChoice[];
        addressId?: string;
      };
      try {
        return await asRuntime(db, { userId: principal.userId }, async (tx) =>
          quoteView(
            await computeQuote(
              tx,
              principal.userId,
              body.deliveries,
              body.addressId,
            ),
          ),
        );
      } catch (err) {
        return refuse(reply, err);
      }
    },
  );

  // ---------- Passage de commande ----------
  app.post(
    "/v1/orders",
    {
      config: writeLimit,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["idempotencyKey", "deliveries", "expectedTotalMinor"],
          properties: {
            idempotencyKey: {
              type: "string",
              pattern: "^[A-Za-z0-9_-]{16,64}$",
            },
            deliveries: deliveriesSchema,
            addressId: uuid,
            // Total vu par l'acheteur : s'il a changé entre-temps, rien n'est commandé.
            expectedTotalMinor: { type: "string", pattern: "^[0-9]{1,15}$" },
          },
        },
        response: { 200: anyObject, 201: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const body = request.body as {
        idempotencyKey: string;
        deliveries: DeliveryChoice[];
        addressId?: string;
        expectedTotalMinor: string;
      };
      const userId = principal.userId;
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            deliveries: [...body.deliveries].sort((a, b) =>
              a.storeSlug.localeCompare(b.storeSlug),
            ),
            addressId: body.addressId ?? null,
            expectedTotalMinor: body.expectedTotalMinor,
          }),
        )
        .digest("hex");
      const replay = async () =>
        asRuntime(db, { userId }, async (tx) => {
          const existing = (await tx.order.findUnique({
            where: {
              buyerId_idempotencyKey: {
                buyerId: userId,
                idempotencyKey: body.idempotencyKey,
              },
            },
            include: orderInclude,
          })) as OrderRow | null;
          if (!existing) return null;
          return existing.requestHash === requestHash
            ? { code: 200 as const, body: orderView(existing) }
            : { code: 409 as const, body: { error: "idempotency_conflict" } };
        });
      const previous = await replay();
      if (previous) return reply.code(previous.code).send(previous.body);
      try {
        const order = await asRuntime(db, { userId }, async (tx) => {
          const quote = await computeQuote(
            tx,
            userId,
            body.deliveries,
            body.addressId,
          );
          if (quote.total.toString() !== body.expectedTotalMinor)
            throw new CheckoutRefusal("total_changed");
          const orderId = randomUUID();
          const expiresAt = new Date(Date.now() + ORDER_PAYMENT_WINDOW_MS);
          const currency = quote.cart.currency;
          // Réservation de chaque ligne : un seul refus annule toute la commande (transaction).
          for (const g of quote.groups)
            for (const line of g.group.lines) {
              const [row] = await tx.$queryRaw<{ outcome: string }[]>`
                SELECT reserve_public_stock(${line.variantId}::uuid, ${line.quantity}::integer,
                  ${`order:${orderId}:${line.variantId}`}, ${expiresAt}) AS outcome`;
              if (row?.outcome !== "reserved")
                throw new CheckoutRefusal(
                  row?.outcome === "insufficient"
                    ? "insufficient_stock"
                    : "unavailable",
                );
            }
          const a = quote.address;
          await tx.order.create({
            data: {
              id: orderId,
              buyerId: userId,
              currency,
              itemsTotalMinor: quote.itemsTotal,
              deliveryTotalMinor: quote.deliveryTotal,
              totalMinor: quote.total,
              idempotencyKey: body.idempotencyKey,
              requestHash,
              expiresAt,
              ...(a
                ? {
                    addressSnapshot: {
                      label: a.label,
                      recipientName: a.recipientName,
                      phone: a.phone,
                      city: a.city,
                      district: a.district,
                      landmark: a.landmark,
                      details: a.details,
                      latitude: a.latitude?.toString() ?? null,
                      longitude: a.longitude?.toString() ?? null,
                    },
                  }
                : {}),
            },
          });
          for (const g of quote.groups) {
            const sellerOrderId = randomUUID();
            await tx.sellerOrder.create({
              data: {
                id: sellerOrderId,
                orderId,
                tenantId: g.store.tenantId,
                storeId: g.store.id,
                storeName: g.store.name,
                deliveryMethod: g.method,
                deliveryFeeMinor: g.fee,
                itemsTotalMinor: g.items,
                pickupInstructions:
                  g.method === "PICKUP" ? g.store.pickupInstructions : null,
              },
            });
            for (const line of g.group.lines)
              await tx.orderItem.create({
                data: {
                  sellerOrderId,
                  tenantId: g.store.tenantId,
                  variantId: line.variantId,
                  title: line.title ?? "",
                  label: line.label ?? "",
                  quantity: line.quantity,
                  unitPriceMinor: BigInt(line.unitPrice?.amountMinor ?? "0"),
                  currency,
                  lineTotalMinor: BigInt(line.lineTotal?.amountMinor ?? "0"),
                  reservationRef: `order:${orderId}:${line.variantId}`,
                },
              });
          }
          // Le panier est vidé dans la même transaction que la commande.
          await tx.cartItem.deleteMany({ where: { cart: { userId } } });
          return (await tx.order.findUniqueOrThrow({
            where: { id: orderId },
            include: orderInclude,
          })) as OrderRow;
        });
        return reply.code(201).send(orderView(order));
      } catch (err) {
        // Double envoi simultané : la contrainte (acheteur, clé) tranche, le perdant est rejoué.
        if (isUniqueViolation(err)) {
          const again = await replay();
          if (again) return reply.code(again.code).send(again.body);
        }
        return refuse(reply, err);
      }
    },
  );

  app.get(
    "/v1/orders",
    { schema: { response: { 401: error } } },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const rows = (await asRuntime(db, { userId: principal.userId }, (tx) =>
        tx.order.findMany({
          orderBy: { createdAt: "desc" },
          take: 50,
          include: orderInclude,
        }),
      )) as OrderRow[];
      return { orders: rows.map(orderView) };
    },
  );

  app.get(
    "/v1/orders/:orderId",
    {
      schema: {
        params: {
          type: "object",
          required: ["orderId"],
          properties: { orderId: uuid },
        },
        response: refusals,
      },
    },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { orderId } = request.params as { orderId: string };
      const order = (await asRuntime(db, { userId: principal.userId }, (tx) =>
        tx.order.findUnique({ where: { id: orderId }, include: orderInclude }),
      )) as OrderRow | null;
      return order
        ? orderView(order)
        : reply.code(404).send({ error: "not_found" });
    },
  );

  app.post(
    "/v1/orders/:orderId/cancel",
    {
      schema: {
        params: {
          type: "object",
          required: ["orderId"],
          properties: { orderId: uuid },
        },
        response: refusals,
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { orderId } = request.params as { orderId: string };
      const outcome = await asRuntime(
        db,
        { userId: principal.userId },
        async (tx) => {
          const exists = await tx.order.count({ where: { id: orderId } });
          if (!exists) return "not_found" as const;
          const [row] = await tx.$queryRaw<{ done: boolean }[]>`
          SELECT close_unpaid_order(${orderId}::uuid, 'CANCELLED'::"OrderStatus") AS done`;
          if (row?.done) return "cancelled" as const;
          // Le payeur valide peut-être en ce moment sur son téléphone : pas d'annulation.
          const pending = await tx.payment.count({
            where: { orderId, status: "PENDING" },
          });
          return pending
            ? ("payment_in_progress" as const)
            : ("not_cancellable" as const);
        },
      );
      if (outcome === "not_found")
        return reply.code(404).send({ error: "not_found" });
      if (outcome !== "cancelled")
        return reply.code(409).send({ error: outcome });
      return { status: "CANCELLED" };
    },
  );

  // ---------- Vue vendeur ----------
  app.get(
    "/v1/stores/:storeId/orders",
    {
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: uuid },
        },
        response: refusals,
      },
    },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId } = request.params as { storeId: string };
      const result = await inStore(
        db,
        principal,
        storeId,
        "order:read",
        async (tx) => {
          const rows = await tx.sellerOrder.findMany({
            where: { storeId },
            orderBy: { createdAt: "desc" },
            take: 100,
            // La commande parent appartient à l'acheteur (RLS) : le vendeur ne la lit pas.
            include: {
              items: { orderBy: { title: "asc" } },
              events: { orderBy: { createdAt: "asc" } },
            },
          });
          // Données personnelles de l'acheteur seulement après paiement confirmé, et
          // seulement celles utiles à la livraison à domicile.
          return rows.map((so) => ({
            deliveryContact:
              so.status === "PAID" ? contactOf(so.deliveryContact) : null,
            ...sellerOrderView(
              so,
              so.items[0]?.currency ?? businessDefaults.currency,
            ),
            // Référence commune acheteur/vendeur pour le support (pas une donnée personnelle).
            orderId: so.orderId,
            createdAt: so.createdAt.toISOString(),
            // Trop de codes erronés : remise bloquée jusqu'à intervention du support.
            handoverLocked: so.handoverAttempts >= 5,
          }));
        },
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      return { orders: result.value };
    },
  );
}
