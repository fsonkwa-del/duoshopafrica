import { asRuntime, type Database } from "@duoshop/database";
import {
  canPlatform,
  type PlatformPermission,
  type PlatformRole,
} from "@duoshop/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import { requirePrincipal } from "./guards";
import type { Principal } from "./session";

// Personnel plateforme : rôle lu en base (pas de rôle déclaré par le client), MFA exigée.
// Un non-membre reçoit 404 : la surface d'administration n'est pas révélée.
export async function requireStaff(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: PlatformPermission,
): Promise<{ principal: Principal; role: PlatformRole } | null> {
  const principal = await requirePrincipal(db, request, reply);
  if (!principal) return null;
  const [row] = await asRuntime(
    db,
    { userId: principal.userId },
    (tx) =>
      tx.$queryRaw<
        { role: PlatformRole | null }[]
      >`SELECT app_platform_role() AS role`,
  );
  const role = row?.role ?? null;
  if (!role) {
    await reply.code(404).send({ error: "not_found" });
    return null;
  }
  if (!principal.mfa) {
    await reply.code(403).send({ error: "mfa_required" });
    return null;
  }
  if (!canPlatform({ role, mfa: principal.mfa, permission })) {
    await reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return { principal, role };
}
