import { asRuntime, type Database } from "./scope";

export interface PendingMedia {
  id: string;
  tenantId: string;
  uploadKey: string;
  createdAt: Date;
}

// Accès du worker aux photos en attente, via les fonctions SQL dédiées (tous tenants).
export function pendingMedia(
  db: Database,
  limit = 20,
): Promise<PendingMedia[]> {
  return asRuntime(
    db,
    {},
    (tx) =>
      tx.$queryRaw<
        PendingMedia[]
      >`SELECT * FROM pending_media(${limit}::integer)`,
  );
}

export async function completeMedia(
  db: Database,
  outcome:
    | {
        id: string;
        status: "READY";
        publicKey: string;
        width: number;
        height: number;
        bytes: number;
      }
    | { id: string; status: "REJECTED"; reason: string },
): Promise<boolean> {
  const ready = outcome.status === "READY" ? outcome : null;
  const [row] = await asRuntime(
    db,
    {},
    (tx) =>
      tx.$queryRaw<{ done: boolean }[]>`
      SELECT complete_media(
        ${outcome.id}::uuid, ${outcome.status}::"MediaStatus", ${ready?.publicKey ?? null},
        ${ready?.width ?? null}::integer, ${ready?.height ?? null}::integer,
        ${ready?.bytes ?? null}::integer,
        ${outcome.status === "REJECTED" ? outcome.reason : null}) AS done`,
  );
  return row?.done ?? false;
}
