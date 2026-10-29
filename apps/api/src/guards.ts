import type { Database } from "@duoshop/database";
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
  if (!principal) await reply.code(401).send({ error: "unauthenticated" });
  return principal;
}

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
