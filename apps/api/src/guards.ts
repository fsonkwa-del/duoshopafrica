import { asRuntime, type Database } from "@duoshop/database";
import type { FastifyReply, FastifyRequest } from "fastify";
import { authenticate, type Principal } from "./session";

export const errorSchema = {
  type: "object",
  required: ["error"],
  properties: { error: { type: "string" } },
} as const;

export async function requirePrincipal(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Principal | null> {
  const principal = await authenticate(db, request);
  if (!principal) {
    await reply.code(401).send({ error: "unauthenticated" });
    return null;
  }
  // Lot 2 (ADR 0010) : CGU et politique de confidentialité en vigueur acceptées avant toute
  // modification. Sans document publié, rien n'est exigé.
  if (request.method !== "GET" && !CONSENT_EXEMPT.test(request.url)) {
    const pending = await asRuntime(
      db,
      { userId: principal.userId },
      (tx) =>
        tx.$queryRaw<{ kind: string; version: number }[]>`
        SELECT kind::text AS kind, version FROM pending_consents(${principal.userId}::uuid)`,
    );
    if (pending.length > 0) {
      await reply.code(428).send({ error: "consent_required", pending });
      return null;
    }
  }
  return principal;
}
// Accepter les textes, se déconnecter ou exercer ses droits reste possible sans consentement.
// Les routes du personnel relèvent de ses règles internes, pas des CGU des utilisateurs.
const CONSENT_EXEMPT = /^\/v1\/(me\/consents|me\/data-requests|auth\/|admin\/)/;

// Mutation par cookie : l'origine doit être celle du site (défense CSRF, SameSite en complément).
export async function requireSameOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
  webOrigin: string,
): Promise<boolean> {
  if (request.headers.origin === webOrigin) return true;
  await reply.code(403).send({ error: "origin_rejected" });
  return false;
}

// Écritures acheteur (panier, adresses, devis, commande, paiement, réclamation) : frein aux abus.
// Compté par IP : derrière un reverse proxy, configurer trustProxy pour obtenir l'IP réelle.
export const writeLimit = { rateLimit: { max: 60, timeWindow: 60_000 } };
