export interface HealthResponse {
  status: "ok";
  service: "api";
  stage: "foundation";
}
export interface MoneyDTO {
  amountMinor: string;
  currency: string;
}
// BigInt est sérialisé en chaîne décimale aux frontières JSON.
export type StoreRoleDTO = "OWNER" | "MANAGER" | "CATALOG" | "FULFILLMENT";
export interface StoreSummaryDTO {
  id: string;
  name: string;
  role: StoreRoleDTO;
}
export interface MeDTO {
  id: string;
  email: string;
  // Second facteur attesté par le fournisseur d'identité pour cette session.
  mfa: boolean;
  // Rôle plateforme actif (lu en base) : sert à afficher l'accès à l'administration.
  platformRole: "ADMIN" | "SUPPORT" | "FINANCE" | null;
  stores: StoreSummaryDTO[];
}
export interface StoreDTO extends StoreSummaryDTO {
  slug: string;
  isDemo: boolean;
  tenantStatus: "PENDING" | "ACTIVE" | "SUSPENDED";
  verification: { status: VerificationStatusDTO; reason: string | null };
  fulfilment: {
    deliveryFeeMinor: string | null;
    pickupEnabled: boolean;
    pickupInstructions: string | null;
    version: number;
  };
}
export type VerificationStatusDTO =
  | "PENDING"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";
export type MerchantDecisionDTO =
  | "APPROVE"
  | "REJECT"
  | "SUSPEND"
  | "REINSTATE";
export interface VerificationQueueItemDTO {
  storeId: string;
  storeName: string;
  storeSlug: string;
  status: VerificationStatusDTO;
  legalName: string | null;
  registrationNumber: string | null;
  submittedAt: string | null;
  version: number;
}
export interface AuditEntryDTO {
  action: string;
  actorId: string;
  requestId: string;
  createdAt: string;
  detail: unknown;
}
// Nom du cookie de session : préfixe __Host- => Secure, Path=/, aucun Domain.
export const SESSION_COOKIE = "__Host-session";
// Jeton opaque du panier visiteur (avant création de compte) ; seule son empreinte est stockée.
export const CART_COOKIE = "__Host-cart";
export type ProductStatusDTO = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export interface StockDTO {
  onHand: number;
  reserved: number;
  available: number;
}
export interface VariantDTO {
  id: string;
  sku: string;
  label: string;
  price: MoneyDTO;
  active: boolean;
  version: number;
  stock: StockDTO;
}
export interface ProductDTO {
  id: string;
  categoryId: string | null;
  title: string;
  description: string | null;
  status: ProductStatusDTO;
  version: number;
  variants: VariantDTO[];
  media: {
    id: string;
    status: "PENDING" | "READY" | "REJECTED";
    rejectReason: string | null;
    altFr: string;
  }[];
}
// Vitrine publique : jamais de quantité exacte de stock (information concurrentielle).
export type AvailabilityDTO = "in_stock" | "low_stock" | "out_of_stock";
export interface PublicStoreDTO {
  name: string;
  slug: string;
}
export interface MediaDTO {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}
export interface CatalogItemDTO {
  id: string;
  title: string;
  store: PublicStoreDTO;
  priceFrom: MoneyDTO;
  priceTo: MoneyDTO;
  availability: AvailabilityDTO;
  image: MediaDTO | null;
  // Unités vendues (paiements confirmés) et année d'ouverture de la boutique.
  sold: number;
  storeSince: number;
}
export interface CatalogPageDTO {
  items: CatalogItemDTO[];
  page: number;
  hasMore: boolean;
}
export interface PublicVariantDTO {
  id: string;
  label: string;
  price: MoneyDTO;
  availability: AvailabilityDTO;
}
export interface PublicProductDTO {
  id: string;
  // Fil d'Ariane : catégorie et, s'il y a lieu, sa catégorie parente.
  category: {
    slug: string;
    name: string;
    parent: { slug: string; name: string } | null;
  } | null;
  title: string;
  description: string | null;
  store: PublicStoreDTO;
  // Encadré vendeur de la fiche : options de remise et ancienneté (année d'ouverture).
  seller: {
    since: number;
    homeDelivery: { fee: MoneyDTO } | null;
    pickup: { instructions: string | null } | null;
  };
  variants: PublicVariantDTO[];
  media: MediaDTO[];
}
export interface CartLineDTO {
  variantId: string;
  productId: string | null;
  title: string | null;
  label: string | null;
  quantity: number;
  unitPrice: MoneyDTO | null;
  previousUnitPrice: MoneyDTO | null;
  lineTotal: MoneyDTO | null;
  status: "ok" | "price_changed" | "insufficient_stock" | "unavailable";
}
export interface CartStoreGroupDTO {
  store: PublicStoreDTO;
  lines: CartLineDTO[];
  subtotal: MoneyDTO;
}
export interface CartDTO {
  currency: string;
  groups: CartStoreGroupDTO[];
  unavailable: CartLineDTO[];
  total: MoneyDTO;
  itemCount: number;
}
export type DeliveryMethodDTO = "HOME_DELIVERY" | "PICKUP";
export type OrderStatusDTO =
  | "AWAITING_PAYMENT"
  | "PAID"
  | "CANCELLED"
  | "EXPIRED";
export interface AddressDTO {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  city: string;
  district: string;
  landmark: string;
  details: string | null;
  hasCoordinates: boolean;
}
export interface DeliveryOptionsDTO {
  store: PublicStoreDTO;
  homeDelivery: { fee: MoneyDTO } | null;
  pickup: { instructions: string | null } | null;
}
export interface QuoteDTO {
  groups: {
    store: PublicStoreDTO;
    method: DeliveryMethodDTO;
    itemsTotal: MoneyDTO;
    deliveryFee: MoneyDTO;
  }[];
  itemsTotal: MoneyDTO;
  deliveryTotal: MoneyDTO;
  total: MoneyDTO;
}
export interface OrderItemDTO {
  id: string;
  title: string;
  label: string;
  quantity: number;
  unitPrice: MoneyDTO;
  lineTotal: MoneyDTO;
}
export type FulfilmentStatusDTO =
  | "AWAITING_PAYMENT"
  | "TO_PREPARE"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERY_FAILED"
  | "DELIVERED";
export interface FulfilmentEventDTO {
  status: FulfilmentStatusDTO;
  note: string | null;
  createdAt: string;
}
export interface SellerOrderDTO {
  id: string;
  storeName: string;
  status: OrderStatusDTO;
  fulfilmentStatus: FulfilmentStatusDTO;
  fulfilmentVersion: number;
  deliveredAt: string | null;
  events: FulfilmentEventDTO[];
  // Acheteur seulement : à donner au vendeur ou au livreur à la réception, pas avant.
  handoverCode: string | null;
  // Réclamation possible (remise prouvée depuis 7 jours au plus, aucune en cours).
  claimable: boolean;
  claims: ClaimDTO[];
  deliveryMethod: DeliveryMethodDTO;
  deliveryFee: MoneyDTO;
  itemsTotal: MoneyDTO;
  pickupInstructions: string | null;
  items: OrderItemDTO[];
}
// Transmis au vendeur seulement après paiement confirmé, pour une livraison à domicile.
export interface DeliveryContactDTO {
  recipientName: string;
  phone: string;
  city: string;
  district: string;
  landmark: string;
  details: string | null;
}
export interface OrderDTO {
  id: string;
  status: OrderStatusDTO;
  itemsTotal: MoneyDTO;
  deliveryTotal: MoneyDTO;
  total: MoneyDTO;
  expiresAt: string;
  createdAt: string;
  paidAt: string | null;
  sellers: SellerOrderDTO[];
  payments: PaymentDTO[];
}

// ---------- Paiements (B06) ----------
export type PaymentModeDTO = "MOCK" | "SANDBOX" | "LIVE";
export type PaymentStatusDTO = "PENDING" | "SUCCEEDED" | "FAILED" | "EXPIRED";
export type PaymentMethodKindDTO =
  | "MOBILE_MONEY"
  | "CARD"
  | "BANK_TRANSFER"
  | "WALLET";
export type NextActionDTO =
  | { type: "approve_on_phone" }
  | { type: "redirect"; url: string }
  | { type: "test_simulator" };
export interface PaymentDTO {
  id: string;
  methodCode: string;
  mode: PaymentModeDTO;
  status: PaymentStatusDTO;
  amount: MoneyDTO;
  // Seuls les 2 derniers chiffres : le numéro complet reste côté serveur.
  payerPhoneHint: string | null;
  nextAction: NextActionDTO | null;
  failureCode: string | null;
  createdAt: string;
  settledAt: string | null;
}
export interface PaymentMethodOptionDTO {
  code: string;
  kind: PaymentMethodKindDTO;
  operator: string | null;
  labelFr: string;
  labelEn: string;
  instructionsFr: string | null;
  instructionsEn: string | null;
  requiresPhone: boolean;
  mode: PaymentModeDTO;
}
export interface AdminPaymentMethodDTO {
  id: string;
  code: string;
  kind: PaymentMethodKindDTO;
  operator: string | null;
  provider: string;
  countryCode: string;
  currency: string;
  labelFr: string;
  labelEn: string;
  instructionsFr: string | null;
  instructionsEn: string | null;
  phonePrefixes: string[];
  minAmountMinor: string;
  maxAmountMinor: string | null;
  displayOrder: number;
  enabled: boolean;
  version: number;
  // Adaptateur présent dans CET environnement (secrets configurés) et son mode.
  providerMode: PaymentModeDTO | null;
}
export interface AdminPaymentDTO {
  id: string;
  orderId: string;
  methodCode: string;
  provider: string;
  mode: PaymentModeDTO;
  status: PaymentStatusDTO;
  amount: MoneyDTO;
  providerReference: string | null;
  attentionReason: string | null;
  createdAt: string;
  settledAt: string | null;
}
export interface AdminProviderEventDTO {
  id: string;
  provider: string;
  eventId: string;
  paymentId: string | null;
  reportedStatus: string;
  amount: MoneyDTO;
  outcome: "APPLIED" | "DUPLICATE" | "QUARANTINED" | "ORPHAN" | "IGNORED";
  detail: string | null;
  receivedAt: string;
}

// ---------- Notifications dans le site (B07) ----------
export interface NotificationDTO {
  id: string;
  kind: string;
  orderId: string | null;
  data: Record<string, string>;
  createdAt: string;
  read: boolean;
}

// ---------- Commissions et rapprochement (B08) ----------
export interface CommissionRuleDTO {
  id: string;
  storeId: string | null;
  storeName: string | null;
  basisPoints: number;
  label: string;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
}
export interface FinanceAnomalyDTO {
  kind:
    | "payment_not_journaled"
    | "no_commission_rule"
    | "daily_mismatch"
    | "unbalanced_journal";
  reference: string;
  expected: string | null;
  posted: string | null;
}
export interface FinanceReportDTO {
  from: string;
  to: string;
  balances: { account: string; currency: string; amount: string }[];
  payables: {
    tenantId: string;
    stores: string | null;
    currency: string;
    amount: string;
  }[];
  anomalies: FinanceAnomalyDTO[];
  daily: { day: string; settled: string; posted: string }[];
  // Dû vendeur gelé par des réclamations en cours.
  holds: {
    tenantId: string;
    stores: string | null;
    currency: string;
    amount: string;
  }[];
}
export interface EarningsDTO {
  lines: {
    sellerOrderId: string;
    reference: string;
    createdAt: string;
    fulfilmentStatus: FulfilmentStatusDTO;
    gross: MoneyDTO | null;
    commissionBasisPoints: number | null;
    commission: MoneyDTO | null;
    net: MoneyDTO | null;
    // Remboursements décidés imputés au vendeur ; réclamation en cours = dû gelé.
    refunded: MoneyDTO;
    onHold: boolean;
  }[];
  // Net dû pour les sous-commandes pas encore remises / déjà remises (commission acquise).
  pending: MoneyDTO;
  earned: MoneyDTO;
  held: MoneyDTO;
}

// ---------- Retours, litiges, remboursements (B09) ----------
export type ClaimStatusDTO =
  | "OPEN"
  | "ACCEPTED"
  | "REJECTED"
  | "ESCALATED"
  | "REFUND_APPROVED"
  | "CLOSED_NO_REFUND"
  | "WITHDRAWN";
export type ClaimReasonDTO =
  | "DAMAGED"
  | "WRONG_ITEM"
  | "NOT_AS_DESCRIBED"
  | "MISSING_ITEM"
  | "OTHER";
export interface ClaimDTO {
  id: string;
  sellerOrderId: string;
  orderId: string;
  storeName: string | null;
  reason: ClaimReasonDTO;
  description: string;
  status: ClaimStatusDTO;
  amount: MoneyDTO;
  version: number;
  createdAt: string;
  items: { title: string; label: string; quantity: number; amount: MoneyDTO }[];
  events: {
    status: ClaimStatusDTO;
    actor: string;
    note: string | null;
    createdAt: string;
  }[];
  // Remboursement décidé, à exécuter par le prestataire de paiement.
  refund: {
    amount: MoneyDTO;
    status: "PENDING_PROVIDER" | "SUCCEEDED" | "FAILED";
  } | null;
}

// ---------- Catégories ----------
export interface CategoryDTO {
  id: string;
  slug: string;
  name: string;
  // Produits publiés de la catégorie et de ses sous-catégories.
  productCount: number;
  children: CategoryDTO[];
}
export interface AdminCategoryDTO {
  id: string;
  slug: string;
  parentId: string | null;
  nameFr: string;
  nameEn: string;
  position: number;
  active: boolean;
}
