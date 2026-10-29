export type StoreRole = "OWNER" | "MANAGER" | "CATALOG" | "FULFILLMENT";
export type TenantStatus = "PENDING" | "ACTIVE" | "SUSPENDED";
export type Permission =
  | "store:read"
  | "store:verify"
  | "store:configure"
  | "catalog:write"
  | "catalog:publish"
  | "inventory:write"
  | "order:read"
  | "order:fulfil"
  | "earnings:read"
  | "claim:respond"
  | "team:manage";
const grants: Record<StoreRole, readonly Permission[]> = {
  OWNER: [
    "store:read",
    "store:verify",
    "store:configure",
    "catalog:write",
    "catalog:publish",
    "inventory:write",
    "order:read",
    "order:fulfil",
    "earnings:read",
    "claim:respond",
    "team:manage",
  ],
  MANAGER: [
    "store:read",
    "store:configure",
    "catalog:write",
    "catalog:publish",
    "inventory:write",
    "order:read",
    "order:fulfil",
    "earnings:read",
    "claim:respond",
  ],
  CATALOG: ["store:read", "catalog:write", "catalog:publish"],
  FULFILLMENT: ["store:read", "inventory:write", "order:read", "order:fulfil"],
};
// En attente d'approbation : on prépare (brouillons, stock) sans rien rendre public ni vendre.
const allowedWhile: Record<TenantStatus, readonly Permission[]> = {
  PENDING: [
    "store:read",
    "store:verify",
    "store:configure",
    "catalog:write",
    "inventory:write",
  ],
  ACTIVE: [
    "store:read",
    "store:configure",
    "catalog:write",
    "catalog:publish",
    "inventory:write",
    "order:read",
    "order:fulfil",
    "earnings:read",
    "claim:respond",
    "team:manage",
  ],
  // Suspendu : aucune action, mais le vendeur garde la vue de ce qui lui est dû.
  SUSPENDED: ["earnings:read"],
};
export interface Membership {
  userId: string;
  tenantId: string;
  storeId: string;
  role: StoreRole;
  active: boolean;
}
// membership et identité doivent provenir du serveur, jamais d'un header tenant fourni par le client.
export function canAccess(input: {
  userId: string;
  tenantId: string;
  storeId: string;
  permission: Permission;
  tenantStatus: TenantStatus;
  membership: Membership;
}): boolean {
  const member = input.membership;
  return (
    allowedWhile[input.tenantStatus].includes(input.permission) &&
    member.active &&
    member.userId === input.userId &&
    member.tenantId === input.tenantId &&
    member.storeId === input.storeId &&
    grants[member.role].includes(input.permission)
  );
}
export function commissionMinor(amount: bigint, basisPoints: number): bigint {
  if (
    amount < 0n ||
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10000
  )
    throw new RangeError("Invalid commission inputs");
  // Arrondi half-up, versionner cette règle avant toute utilisation contractuelle.
  return (amount * BigInt(basisPoints) + 5000n) / 10000n;
}

// Personnel plateforme : toute permission exige une session dont le second facteur est attesté.
// FINANCE : fonction financière séparée des opérations (cahier : séparer opérationnel/finance/sécurité).
export type PlatformRole = "ADMIN" | "SUPPORT" | "FINANCE";
export type PlatformPermission =
  | "merchant:review"
  | "merchant:decide"
  | "payment:review"
  | "payment:configure"
  | "finance:review"
  | "finance:configure"
  | "claim:review"
  | "claim:decide";
const platformGrants: Record<PlatformRole, readonly PlatformPermission[]> = {
  ADMIN: [
    "merchant:review",
    "merchant:decide",
    "payment:review",
    "payment:configure",
    "finance:review",
    "claim:review",
    "claim:decide",
  ],
  // Le support instruit les litiges ; l'arbitrage (décision d'argent) revient à l'ADMIN.
  SUPPORT: ["merchant:review", "payment:review", "claim:review"],
  // Les règles de commission ne sont modifiables que par la finance ; l'admin les consulte.
  FINANCE: ["payment:review", "finance:review", "finance:configure"],
};
export function canPlatform(input: {
  role: PlatformRole | null;
  mfa: boolean;
  permission: PlatformPermission;
}): boolean {
  return (
    input.role !== null &&
    input.mfa &&
    platformGrants[input.role].includes(input.permission)
  );
}

export type VerificationStatus =
  | "PENDING"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";
export type MerchantDecision = "APPROVE" | "REJECT" | "SUSPEND" | "REINSTATE";
export const DECISION_REASON_MIN_LENGTH = 10;
// Hypothèse documentée : l'approbation d'une boutique active son organisation (tenant).
const decisions: Record<
  MerchantDecision,
  {
    from: readonly VerificationStatus[];
    to: VerificationStatus;
    tenant: TenantStatus;
  }
> = {
  APPROVE: { from: ["SUBMITTED"], to: "APPROVED", tenant: "ACTIVE" },
  REJECT: { from: ["SUBMITTED"], to: "REJECTED", tenant: "PENDING" },
  SUSPEND: { from: ["APPROVED"], to: "SUSPENDED", tenant: "SUSPENDED" },
  REINSTATE: { from: ["SUSPENDED"], to: "APPROVED", tenant: "ACTIVE" },
};
export function applyDecision(
  current: VerificationStatus,
  decision: MerchantDecision,
): { status: VerificationStatus; tenantStatus: TenantStatus } | null {
  const rule = decisions[decision];
  return rule.from.includes(current)
    ? { status: rule.to, tenantStatus: rule.tenant }
    : null;
}
export function canSubmitVerification(current: VerificationStatus): boolean {
  return current === "PENDING" || current === "REJECTED";
}

// Prix saisi en unités mineures (XAF : francs entiers). Texte décimal strict, jamais de flottant.
export const MAX_PRICE_DIGITS = 15;
export function parsePriceMinor(input: string): bigint | null {
  const value = input.trim();
  if (!/^[0-9]+$/.test(value) || value.length > MAX_PRICE_DIGITS) return null;
  const amount = BigInt(value);
  return amount > 0n ? amount : null;
}

export function normalizeSku(input: string): string | null {
  const sku = input.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku) ? sku : null;
}

// Un ajustement ne peut jamais rendre le stock physique inférieur au stock déjà réservé.
export function canAdjustStock(
  level: { onHand: number; reserved: number },
  delta: number,
): boolean {
  return (
    Number.isInteger(delta) &&
    delta !== 0 &&
    level.onHand + delta >= level.reserved
  );
}

export type ProductStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
const productTransitions: Record<ProductStatus, readonly ProductStatus[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};
export function canChangeProductStatus(
  from: ProductStatus,
  to: ProductStatus,
): boolean {
  return productTransitions[from].includes(to);
}
// Publier rend le produit visible des acheteurs : permission distincte, réservée aux vendeurs approuvés.
export function permissionForProductStatus(to: ProductStatus): Permission {
  return to === "PUBLISHED" ? "catalog:publish" : "catalog:write";
}

// Seuil d'affichage « stock faible » côté acheteur ; la quantité exacte n'est jamais exposée.
export const LOW_STOCK_THRESHOLD = 3;
export function availabilityOf(
  available: number,
): "in_stock" | "low_stock" | "out_of_stock" {
  if (available <= 0) return "out_of_stock";
  return available <= LOW_STOCK_THRESHOLD ? "low_stock" : "in_stock";
}

// Requête utilisateur -> tsquery sûre : seulement lettres/chiffres, préfixes, 6 termes maximum.
export function toSearchQuery(input: string): string | null {
  const terms = (input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((term) => term.length >= 2)
    .slice(0, 6);
  return terms.length ? terms.map((term) => `${term}:*`).join(" & ") : null;
}

// Numéros camerounais : 9 chiffres (mobiles en 6, fixes en 2), saisis avec ou sans indicatif.
// Résultat au format E.164 (+237XXXXXXXXX) ; tout autre format est refusé pour l'instant.
export function normalizeCameroonPhone(input: string): string | null {
  const digits = input.replace(/[\s.-]/g, "");
  const national = digits.replace(/^(?:\+|00)237/, "");
  return /^[26][0-9]{8}$/.test(national) ? `+237${national}` : null;
}

// Coordonnées facultatives, arrondies à 4 décimales (~11 m) : assez pour livrer, pas davantage.
export function roundCoordinate(value: number, limit: 90 | 180): number | null {
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  return Math.round(value * 10_000) / 10_000;
}

export const ORDER_PAYMENT_WINDOW_MS = 30 * 60_000;

// Tentative de paiement sans réponse : au-delà, une nouvelle tentative est permise (SQL : 10 minutes).
export const PAYMENT_ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000;
// Préfixes E.164 configurés par opérateur ; liste vide = aucun filtrage.
export function phoneMatchesPrefixes(
  phone: string,
  prefixes: readonly string[],
): boolean {
  return prefixes.length === 0 || prefixes.some((p) => phone.startsWith(p));
}

// ---------- Préparation et remise (B07) ----------
// Miroir de la fonction SQL advance_fulfilment, qui reste seule juge.
export type FulfilmentStatus =
  | "AWAITING_PAYMENT"
  | "TO_PREPARE"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERY_FAILED"
  | "DELIVERED";
export type DeliveryMethod = "HOME_DELIVERY" | "PICKUP";
export function nextFulfilmentSteps(
  method: DeliveryMethod,
  from: FulfilmentStatus,
): FulfilmentStatus[] {
  switch (from) {
    case "TO_PREPARE":
      return ["READY"];
    case "READY":
      // Retrait : remise directe au comptoir contre le code de l'acheteur.
      return method === "PICKUP" ? ["DELIVERED"] : ["OUT_FOR_DELIVERY"];
    case "OUT_FOR_DELIVERY":
      return ["DELIVERED", "DELIVERY_FAILED"];
    case "DELIVERY_FAILED":
      return ["OUT_FOR_DELIVERY"];
    default:
      return [];
  }
}
// Remise prouvée par le code à 6 chiffres que seul l'acheteur connaît.
export const HANDOVER_CODE_PATTERN = /^[0-9]{6}$/;
export const HANDOVER_MAX_ATTEMPTS = 5;

// ---------- Retours, litiges, remboursements (B09) ----------
// Miroir des fonctions SQL (open_claim, respond_claim, escalate_claim, arbitrate_claim, withdraw_claim).
export const CLAIM_WINDOW_DAYS = 7;
export type ClaimStatus =
  | "OPEN"
  | "ACCEPTED"
  | "REJECTED"
  | "ESCALATED"
  | "REFUND_APPROVED"
  | "CLOSED_NO_REFUND"
  | "WITHDRAWN";
export type ClaimActor = "buyer" | "seller" | "platform";
const claimMoves: Record<
  ClaimActor,
  Partial<Record<ClaimStatus, ClaimStatus[]>>
> = {
  buyer: {
    OPEN: ["WITHDRAWN"],
    REJECTED: ["ESCALATED", "WITHDRAWN"],
    ESCALATED: ["WITHDRAWN"],
  },
  seller: { OPEN: ["ACCEPTED", "REJECTED"] },
  platform: { ESCALATED: ["REFUND_APPROVED", "CLOSED_NO_REFUND"] },
};
export function nextClaimSteps(
  actor: ClaimActor,
  from: ClaimStatus,
): ClaimStatus[] {
  return claimMoves[actor][from] ?? [];
}
// Réclamation en cours : le dû vendeur de la vente est gelé.
export function claimHoldsPayout(status: ClaimStatus): boolean {
  return status === "OPEN" || status === "REJECTED" || status === "ESCALATED";
}
export function canOpenClaim(input: {
  fulfilmentStatus: FulfilmentStatus;
  deliveredAt: Date | null;
  now: Date;
}): boolean {
  return (
    input.fulfilmentStatus === "DELIVERED" &&
    input.deliveredAt !== null &&
    input.now.getTime() - input.deliveredAt.getTime() <=
      CLAIM_WINDOW_DAYS * 24 * 3600_000
  );
}
// Commission reprise sur un remboursement : même taux et même arrondi qu'à l'origine,
// plafonnée à ce qui reste de la commission prélevée.
export function commissionReversal(
  refund: bigint,
  basisPoints: number,
  remainingCommission: bigint,
): bigint {
  const reversal = commissionMinor(refund, basisPoints);
  return reversal > remainingCommission ? remainingCommission : reversal;
}
