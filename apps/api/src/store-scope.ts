import {
  asRuntime,
  type Database,
  enterTenant,
  type ScopedTx,
} from "@duoshop/database";
import {
  canAccess,
  type Permission,
  type StoreRole,
  type TenantStatus,
} from "@duoshop/domain";
import type { Principal } from "./session";

export interface StoreContext {
  tenantId: string;
  storeId: string;
  role: StoreRole;
  tenantStatus: TenantStatus;
  userId: string;
}
export type Scoped<T> =
  | { ok: true; value: T }
  | { ok: false; status: 403 | 404; error: string };

// Résout l'adhésion côté serveur, entre dans le tenant, applique la politique, puis exécute fn
// dans la MÊME transaction. Boutique inconnue, étrangère ou adhésion inactive : 404 identique.
export async function inStore<T>(
  db: Database,
  principal: Principal,
  storeId: string,
  permission: Permission,
  fn: (tx: ScopedTx, ctx: StoreContext) => Promise<T>,
): Promise<Scoped<T>> {
  return asRuntime(db, { userId: principal.userId }, async (tx) => {
    const membership = await tx.storeMember.findFirst({
      where: { storeId, userId: principal.userId, active: true },
      select: {
        tenantId: true,
        storeId: true,
        userId: true,
        role: true,
        active: true,
      },
    });
    if (!membership) return { ok: false, status: 404, error: "not_found" };
    await enterTenant(tx, membership.tenantId);
    const tenant = await tx.tenant.findUnique({
      where: { id: membership.tenantId },
      select: { status: true },
    });
    if (!tenant) return { ok: false, status: 404, error: "not_found" };
    if (
      !canAccess({
        userId: principal.userId,
        tenantId: membership.tenantId,
        storeId,
        permission,
        tenantStatus: tenant.status,
        membership,
      })
    )
      return {
        ok: false,
        status: 403,
        error:
          tenant.status === "SUSPENDED" ? "store_unavailable" : "forbidden",
      };
    const value = await fn(tx, {
      tenantId: membership.tenantId,
      storeId,
      role: membership.role,
      tenantStatus: tenant.status,
      userId: principal.userId,
    });
    return { ok: true, value };
  });
}
