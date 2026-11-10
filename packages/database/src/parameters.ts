import type { ScopedTx } from "./scope";

// Paramètres réglementaires datés (ADR 0008). Écritures uniquement par les fonctions SQL, qui
// contrôlent le rôle, la valeur, la non-rétroactivité et la seconde personne.
export type ParameterRefusal =
  | "parameter_unknown"
  | "parameter_forbidden"
  | "parameter_scope"
  | "parameter_store_unknown"
  | "parameter_invalid"
  | "parameter_retroactive"
  | "parameter_basis_required";
const refusals: readonly ParameterRefusal[] = [
  "parameter_unknown",
  "parameter_forbidden",
  "parameter_scope",
  "parameter_store_unknown",
  "parameter_invalid",
  "parameter_retroactive",
  "parameter_basis_required",
];
// Exception levée par propose_parameter : son message est le code du refus.
export function parameterRefusal(error: unknown): ParameterRefusal | null {
  const text = error instanceof Error ? error.message : String(error);
  return refusals.find((code) => text.includes(code)) ?? null;
}

export async function proposeParameter(
  tx: ScopedTx,
  input: {
    key: string;
    storeId: string | null;
    value: string;
    effectiveFrom: Date;
    legalBasis: string | null;
    validated: boolean;
  },
): Promise<string> {
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    SELECT propose_parameter(${input.key}, ${input.storeId}::uuid, ${input.value},
      ${input.effectiveFrom}::timestamptz, ${input.legalBasis}, ${input.validated}) AS id`;
  if (!row) throw new Error("propose_parameter returned nothing");
  return row.id;
}

export type ParameterDecision =
  | "approved"
  | "rejected"
  | "not_found"
  | "already_decided"
  | "same_person"
  | "reason_required"
  | "retroactive"
  | "conflict";
export async function decideParameter(
  tx: ScopedTx,
  id: string,
  approve: boolean,
  reason: string | null,
): Promise<ParameterDecision> {
  const [row] = await tx.$queryRaw<{ outcome: ParameterDecision }[]>`
    SELECT decide_parameter(${id}::uuid, ${approve}, ${reason}) AS outcome`;
  return row?.outcome ?? "not_found";
}
