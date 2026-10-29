import { randomUUID } from "node:crypto";
import { type Database, issueSessionToken } from "@duoshop/database";
import type { FastifyInstance } from "fastify";
import { errorSchema as error, requireSameOrigin } from "./guards";

// DÉVELOPPEMENT UNIQUEMENT (DEV_LOGIN_ENABLED, refusé en production par main.ts) :
// remplace la connexion Zitadel absente par trois profils de démonstration fixes.
// Seuls des comptes @example.invalid et des boutiques DEMO sont concernés.
export const DEMO_PROFILES = {
  buyer: "acheteur@example.invalid",
  seller: "vendeuse@example.invalid",
  admin: "admin@example.invalid",
} as const;
// « newBuyer » simule une inscription : un compte acheteur neuf à chaque fois.
type Profile = keyof typeof DEMO_PROFILES | "newBuyer";

export async function devLoginRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;
  app.post(
    "/v1/dev/sessions",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["profile"],
          properties: {
            profile: { enum: [...Object.keys(DEMO_PROFILES), "newBuyer"] },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["token"],
            properties: { token: { type: "string" } },
          },
          403: error,
          404: error,
        },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const { profile } = request.body as { profile: Profile };
      const email =
        profile === "newBuyer"
          ? `client-${randomUUID().slice(0, 8)}@example.invalid`
          : DEMO_PROFILES[profile];
      const { token, tokenHash } = issueSessionToken();
      const created = await db.$transaction(async (tx) => {
        const user = await tx.user.upsert({
          where: { email },
          create: { email },
          update: {},
        });
        if (profile === "seller") {
          const stores = await tx.store.findMany({ where: { isDemo: true } });
          if (stores.length === 0) return false;
          for (const store of stores)
            await tx.storeMember.upsert({
              where: {
                tenantId_storeId_userId: {
                  tenantId: store.tenantId,
                  storeId: store.id,
                  userId: user.id,
                },
              },
              create: {
                tenantId: store.tenantId,
                storeId: store.id,
                userId: user.id,
                role: "OWNER",
              },
              update: { role: "OWNER", active: true },
            });
        }
        if (profile === "admin")
          await tx.platformMember.upsert({
            where: { userId: user.id },
            create: { userId: user.id, role: "ADMIN" },
            update: { role: "ADMIN", active: true },
          });
        await tx.session.create({
          data: {
            userId: user.id,
            tokenHash,
            // Second facteur déclaré pour l'admin de démo seulement ; la vraie attestation
            // passe par Zitadel (amr « mfa »).
            mfa: profile === "admin",
            expiresAt: new Date(Date.now() + 12 * 3600_000),
          },
        });
        return true;
      });
      if (!created) return reply.code(404).send({ error: "no_demo_store" });
      request.log.warn({ profile }, "demo session issued (development only)");
      return { token };
    },
  );
}
