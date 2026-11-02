import {
  asRuntime,
  type Database,
  hashSessionToken,
  type ScopedTx,
} from "@duoshop/database";
import {
  CART_COOKIE,
  type CartDTO,
  type CartLineDTO,
  type CartStoreGroupDTO,
} from "@duoshop/types";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { errorSchema as error, requireSameOrigin, writeLimit } from "./guards";
import { authenticate, readCookie } from "./session";

export const MAX_CART_LINES = 50;

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "P2002"
  );
}

// Recalcule tout à la lecture : prix et disponibilité courants, jamais ceux mémorisés.
// Une variante devenue invisible (dépubliée, vendeur suspendu) apparaît « indisponible »
// sans rien révéler d'elle : la RLS publique ne la renvoie simplement plus.
export type CartOwner = { userId: string } | { guestTokenHash: string };

export async function buildCart(
  tx: ScopedTx,
  owner: CartOwner,
): Promise<CartDTO> {
  const cart = await tx.cart.findUnique({
    where: owner,
    include: { items: { orderBy: { addedAt: "asc" } } },
  });
  const currency = cart?.currency ?? "XAF";
  const items = cart?.items ?? [];
  const variants = await tx.productVariant.findMany({
    where: { id: { in: items.map((i) => i.variantId) } },
    select: {
      id: true,
      label: true,
      priceMinor: true,
      currency: true,
      stock: { select: { onHand: true, reserved: true } },
      product: {
        select: {
          id: true,
          title: true,
          store: { select: { name: true, slug: true } },
        },
      },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const groups = new Map<string, CartStoreGroupDTO & { sum: bigint }>();
  const unavailable: CartLineDTO[] = [];
  let total = 0n;
  for (const item of items) {
    const variant = byId.get(item.variantId);
    if (!variant) {
      unavailable.push({
        variantId: item.variantId,
        productId: null,
        title: null,
        label: null,
        quantity: item.quantity,
        unitPrice: null,
        previousUnitPrice: null,
        lineTotal: null,
        status: "unavailable",
      });
      continue;
    }
    const available = variant.stock.reduce(
      (s, l) => s + l.onHand - l.reserved,
      0,
    );
    const lineTotal = variant.priceMinor * BigInt(item.quantity);
    const status: CartLineDTO["status"] =
      available < item.quantity
        ? "insufficient_stock"
        : variant.priceMinor !== item.addedPriceMinor
          ? "price_changed"
          : "ok";
    const store = variant.product.store;
    const group = groups.get(store.slug) ?? {
      store,
      lines: [],
      subtotal: { amountMinor: "0", currency },
      sum: 0n,
    };
    group.lines.push({
      variantId: variant.id,
      productId: variant.product.id,
      title: variant.product.title,
      label: variant.label,
      quantity: item.quantity,
      unitPrice: { amountMinor: variant.priceMinor.toString(), currency },
      previousUnitPrice:
        status === "price_changed"
          ? { amountMinor: item.addedPriceMinor.toString(), currency }
          : null,
      lineTotal: { amountMinor: lineTotal.toString(), currency },
      status,
    });
    group.sum += lineTotal;
    total += lineTotal;
    groups.set(store.slug, group);
  }
  return {
    currency,
    groups: [...groups.values()].map(({ sum, ...group }) => ({
      ...group,
      subtotal: { amountMinor: sum.toString(), currency },
    })),
    unavailable,
    total: { amountMinor: total.toString(), currency },
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
  };
}

// Acheteur courant : compte connecté et/ou panier visiteur (cookie). Dès que les deux sont
// présents, le panier visiteur est fusionné dans celui du compte, puis supprimé.
export async function resolveShopper(
  db: Database,
  request: FastifyRequest,
): Promise<{ owner: CartOwner; userId: string | null } | null> {
  const principal = await authenticate(db, request);
  const token = readCookie(request, CART_COOKIE);
  const guestTokenHash = token ? hashSessionToken(token) : null;
  if (principal) {
    if (guestTokenHash)
      await mergeGuestCart(db, principal.userId, guestTokenHash);
    return { owner: { userId: principal.userId }, userId: principal.userId };
  }
  return guestTokenHash ? { owner: { guestTokenHash }, userId: null } : null;
}

export const scopeOf = (owner: CartOwner) =>
  "userId" in owner
    ? { userId: owner.userId }
    : { guestCart: owner.guestTokenHash };

// Quantités additionnées (plafond 99) ; prix de référence = celui vu par le visiteur.
export async function mergeGuestCart(
  db: Database,
  userId: string,
  guestTokenHash: string,
): Promise<void> {
  const merge = () =>
    asRuntime(db, { userId, guestCart: guestTokenHash }, async (tx) => {
      // Verrou sur le panier visiteur : une fusion simultanée attend, puis ne le trouve plus.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Cart" WHERE "guestTokenHash" = ${guestTokenHash} FOR UPDATE`;
      if (!locked.length) return;
      const guest = await tx.cart.findUnique({
        where: { guestTokenHash },
        include: { items: true },
      });
      if (!guest) return;
      const cart =
        (await tx.cart.findUnique({ where: { userId } })) ??
        (await tx.cart.create({ data: { userId } }));
      for (const item of guest.items) {
        const existing = await tx.cartItem.findUnique({
          where: {
            cartId_variantId: { cartId: cart.id, variantId: item.variantId },
          },
        });
        if (existing)
          await tx.cartItem.update({
            where: { id: existing.id },
            data: { quantity: Math.min(99, existing.quantity + item.quantity) },
          });
        else if (
          (await tx.cartItem.count({ where: { cartId: cart.id } })) <
          MAX_CART_LINES
        )
          await tx.cartItem.create({
            data: {
              cartId: cart.id,
              variantId: item.variantId,
              quantity: item.quantity,
              addedPriceMinor: item.addedPriceMinor,
            },
          });
      }
      await tx.cart.delete({ where: { id: guest.id } });
      await tx.cart.update({
        where: { id: cart.id },
        data: { updatedAt: new Date() },
      });
    });
  try {
    await merge();
  } catch (err) {
    // Deux requêtes simultanées juste après la connexion : l'autre a déjà fusionné.
    if (!isUniqueViolation(err)) throw err;
    await merge();
  }
}

const emptyCart: CartDTO = {
  currency: "XAF",
  groups: [],
  unavailable: [],
  total: { amountMinor: "0", currency: "XAF" },
  itemCount: 0,
};

export async function cartRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;

  // Panier consultable sans compte : vide tant qu'aucun article n'a été ajouté.
  app.get("/v1/cart", async (request) => {
    const shopper = await resolveShopper(db, request);
    if (!shopper) return emptyCart;
    return asRuntime(db, scopeOf(shopper.owner), (tx) =>
      buildCart(tx, shopper.owner),
    );
  });

  app.post(
    "/v1/cart/items",
    {
      config: writeLimit,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["variantId", "quantity"],
          properties: {
            variantId: { type: "string", format: "uuid" },
            // 0 retire la ligne ; la quantité est une valeur cible, pas un incrément (rejouable).
            quantity: { type: "integer", minimum: 0, maximum: 99 },
          },
        },
        response: {
          400: error,
          401: error,
          403: error,
          404: error,
          409: error,
        },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const shopper = await resolveShopper(db, request);
      // Ni session ni jeton visiteur : le site pose le cookie __Host-cart avant d'appeler.
      if (!shopper)
        return reply.code(400).send({ error: "cart_token_required" });
      const { owner } = shopper;
      const { variantId, quantity } = request.body as {
        variantId: string;
        quantity: number;
      };
      const apply = () =>
        asRuntime(db, scopeOf(owner), async (tx) => {
          const cart =
            (await tx.cart.findUnique({ where: owner })) ??
            (await tx.cart.create({ data: owner }));
          if (quantity === 0) {
            await tx.cartItem.deleteMany({
              where: { cartId: cart.id, variantId },
            });
            return { code: 200 as const, body: await buildCart(tx, owner) };
          }
          // Visible seulement si publiée par un vendeur actif (RLS publique).
          const variant = await tx.productVariant.findUnique({
            where: { id: variantId },
            select: { priceMinor: true, currency: true },
          });
          if (!variant) return { code: 404 as const, error: "unavailable" };
          if (variant.currency !== cart.currency)
            return { code: 409 as const, error: "currency_mismatch" };
          const existing = await tx.cartItem.findUnique({
            where: { cartId_variantId: { cartId: cart.id, variantId } },
          });
          if (existing)
            // Re-saisir la quantité vaut acceptation du prix courant.
            await tx.cartItem.update({
              where: { id: existing.id },
              data: { quantity, addedPriceMinor: variant.priceMinor },
            });
          else {
            if (
              (await tx.cartItem.count({ where: { cartId: cart.id } })) >=
              MAX_CART_LINES
            )
              return { code: 409 as const, error: "cart_full" };
            await tx.cartItem.create({
              data: {
                cartId: cart.id,
                variantId,
                quantity,
                addedPriceMinor: variant.priceMinor,
              },
            });
          }
          await tx.cart.update({
            where: { id: cart.id },
            data: { updatedAt: new Date() },
          });
          return { code: 200 as const, body: await buildCart(tx, owner) };
        });
      let outcome: Awaited<ReturnType<typeof apply>>;
      try {
        outcome = await apply();
      } catch (err) {
        // Deux ajouts simultanés (double clic) : la contrainte d'unicité tranche, on rejoue.
        if (!isUniqueViolation(err)) throw err;
        outcome = await apply();
      }
      return "body" in outcome
        ? outcome.body
        : reply.code(outcome.code).send({ error: outcome.error });
    },
  );
}
