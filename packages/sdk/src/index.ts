import {
  type AddressDTO,
  type AdminCategoryDTO,
  type AdminPaymentDTO,
  type AdminPaymentMethodDTO,
  type AdminProviderEventDTO,
  type AuditEntryDTO,
  CART_COOKIE,
  type CartDTO,
  type CatalogPageDTO,
  type CategoryDTO,
  type ClaimDTO,
  type ClaimReasonDTO,
  type CommissionRuleDTO,
  type DeliveryContactDTO,
  type DeliveryMethodDTO,
  type DeliveryOptionsDTO,
  type DeliveryZoneDTO,
  type EarningsDTO,
  type FinanceReportDTO,
  type HealthResponse,
  type MeDTO,
  type MerchantDecisionDTO,
  type MoneyDTO,
  type NotificationDTO,
  type OrderDTO,
  type ParametersDTO,
  type PaymentDTO,
  type PaymentMethodOptionDTO,
  type PaymentModeDTO,
  type ProductDTO,
  type ProductStatusDTO,
  type PublicProductDTO,
  type QuoteDTO,
  SESSION_COOKIE,
  type SellerOrderDTO,
  type StockDTO,
  type StoreDTO,
  type StoreZoneFeeDTO,
  type VerificationQueueItemDTO,
  type VerificationStatusDTO,
  type VerificationSubmissionDTO,
} from "@duoshop/types";
export async function getHealth(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<HealthResponse> {
  const response = await fetch(
    new URL("/health/live", baseUrl),
    signal ? { signal } : {},
  );
  if (!response.ok) throw new Error("API health request failed");
  return response.json() as Promise<HealthResponse>;
}

// Résultat explicite : les refus métier sont des issues attendues, pas des exceptions.
type Refusal = 400 | 401 | 403 | 404 | 409 | 428 | 429;
const refusals: readonly number[] = [400, 401, 403, 404, 409, 428, 429];
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: Refusal; error?: string };

// Acheteur : session de compte et/ou jeton de panier visiteur (cookies httpOnly relayés).
export interface Shopper {
  session: string | null;
  cart: string | null;
}
function cookieHeader(credentials: string | Shopper): string {
  if (typeof credentials === "string")
    return `${SESSION_COOKIE}=${credentials}`;
  return [
    credentials.session ? `${SESSION_COOKIE}=${credentials.session}` : null,
    credentials.cart ? `${CART_COOKIE}=${credentials.cart}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

// Appels serveur à serveur : le jeton de session est relayé, jamais exposé au JavaScript du navigateur.
async function authorized<T>(
  baseUrl: string,
  path: string,
  sessionToken: string | Shopper,
  write?: { origin: string; body: unknown },
): Promise<ApiResult<T>> {
  const cookie = cookieHeader(sessionToken);
  const response = await fetch(new URL(path, baseUrl), {
    cache: "no-store",
    ...(write
      ? {
          method: "POST",
          body: JSON.stringify(write.body),
          headers: {
            cookie,
            origin: write.origin,
            "content-type": "application/json",
          },
        }
      : { headers: { cookie } }),
  });
  if (response.ok) return { ok: true, data: (await response.json()) as T };
  if (refusals.includes(response.status)) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    return {
      ok: false,
      status: response.status as Refusal,
      ...(body.error ? { error: body.error } : {}),
    };
  }
  throw new Error(`API request failed with status ${response.status}`);
}
const store = (storeId: string) => encodeURIComponent(storeId);

export const getMe = (baseUrl: string, sessionToken: string) =>
  authorized<MeDTO>(baseUrl, "/v1/me", sessionToken);
export const getStore = (
  baseUrl: string,
  sessionToken: string,
  storeId: string,
) =>
  authorized<StoreDTO>(baseUrl, `/v1/stores/${store(storeId)}`, sessionToken);
export const openStore = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: { name: string; slug: string },
) =>
  authorized<{ id: string }>(baseUrl, "/v1/stores", sessionToken, {
    origin,
    body,
  });
export const submitVerification = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  body: VerificationSubmissionDTO,
) =>
  authorized<{ status: "SUBMITTED" }>(
    baseUrl,
    `/v1/stores/${store(storeId)}/verification`,
    sessionToken,
    { origin, body },
  );
export const getVerificationQueue = (
  baseUrl: string,
  sessionToken: string,
  status: VerificationStatusDTO,
) =>
  authorized<{ items: VerificationQueueItemDTO[] }>(
    baseUrl,
    `/v1/admin/verifications?status=${status}`,
    sessionToken,
  );
export const decideVerification = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  body: {
    decision: MerchantDecisionDTO;
    reason: string;
    expectedVersion: number;
  },
) =>
  authorized<{ status: VerificationStatusDTO; version: number }>(
    baseUrl,
    `/v1/admin/verifications/${store(storeId)}/decision`,
    sessionToken,
    { origin, body },
  );
export const getStoreAudit = (
  baseUrl: string,
  sessionToken: string,
  storeId: string,
) =>
  authorized<{ entries: AuditEntryDTO[] }>(
    baseUrl,
    `/v1/admin/stores/${store(storeId)}/audit`,
    sessionToken,
  );
export const listProducts = (
  baseUrl: string,
  sessionToken: string,
  storeId: string,
) =>
  authorized<{ products: ProductDTO[] }>(
    baseUrl,
    `/v1/stores/${store(storeId)}/products`,
    sessionToken,
  );
export const createProduct = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  body: {
    title: string;
    description?: string;
    categoryId?: string;
    variants: { sku: string; label: string; priceMinor: string }[];
  },
) =>
  authorized<ProductDTO>(
    baseUrl,
    `/v1/stores/${store(storeId)}/products`,
    sessionToken,
    { origin, body },
  );
export const changeProductStatus = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  productId: string,
  body: { status: ProductStatusDTO; expectedVersion: number },
) =>
  authorized<{ status: ProductStatusDTO; version: number }>(
    baseUrl,
    `/v1/stores/${store(storeId)}/products/${encodeURIComponent(productId)}/status`,
    sessionToken,
    { origin, body },
  );
export const changePrice = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  variantId: string,
  body: { priceMinor: string; expectedVersion: number },
) =>
  authorized<{ price: MoneyDTO; version: number }>(
    baseUrl,
    `/v1/stores/${store(storeId)}/variants/${encodeURIComponent(variantId)}/price`,
    sessionToken,
    { origin, body },
  );
export const moveStock = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  variantId: string,
  body: {
    delta: number;
    reason: "RECEIPT" | "ADJUSTMENT";
    note?: string;
    idempotencyKey: string;
  },
) =>
  authorized<{ replayed: boolean; stock: StockDTO }>(
    baseUrl,
    `/v1/stores/${store(storeId)}/variants/${encodeURIComponent(variantId)}/stock`,
    sessionToken,
    { origin, body },
  );
// Vitrine : lecture publique, aucun cookie transmis (rien de personnel dans ces réponses).
export async function searchCatalog(
  baseUrl: string,
  query: { q?: string; page?: number; lang: "fr" | "en"; category?: string },
): Promise<CatalogPageDTO> {
  const params = new URLSearchParams({ lang: query.lang });
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const response = await fetch(
    new URL(`/v1/catalog/products?${params}`, baseUrl),
    {
      cache: "no-store",
    },
  );
  if (response.status === 400) return { items: [], page: 1, hasMore: false };
  if (!response.ok)
    throw new Error(`Catalog request failed with status ${response.status}`);
  return (await response.json()) as CatalogPageDTO;
}
export async function getCatalogProduct(
  baseUrl: string,
  productId: string,
  lang: "fr" | "en",
): Promise<PublicProductDTO | null> {
  const response = await fetch(
    new URL(
      `/v1/catalog/products/${encodeURIComponent(productId)}?lang=${lang}`,
      baseUrl,
    ),
    { cache: "no-store" },
  );
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok)
    throw new Error(`Product request failed with status ${response.status}`);
  return (await response.json()) as PublicProductDTO;
}
export const getCart = (baseUrl: string, shopper: Shopper) =>
  authorized<CartDTO>(baseUrl, "/v1/cart", shopper);
export const setCartLine = (
  baseUrl: string,
  shopper: Shopper,
  origin: string,
  body: { variantId: string; quantity: number },
) =>
  authorized<CartDTO>(baseUrl, "/v1/cart/items", shopper, {
    origin,
    body,
  });
export const requestMediaUpload = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  productId: string,
  body: { contentType: string; bytes: number; altFr: string; altEn: string },
) =>
  authorized<{
    mediaId: string;
    upload: {
      url: string;
      method: "PUT";
      headers: Record<string, string>;
      expiresAt: string;
    };
  }>(
    baseUrl,
    `/v1/stores/${store(storeId)}/products/${encodeURIComponent(productId)}/media`,
    sessionToken,
    { origin, body },
  );
export const changeMedia = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  productId: string,
  mediaId: string,
  action: "remove" | "primary",
) =>
  authorized<{ ok: true }>(
    baseUrl,
    `/v1/stores/${store(storeId)}/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(mediaId)}/${action}`,
    sessionToken,
    { origin, body: {} },
  );
export const getCheckout = (baseUrl: string, shopper: string | Shopper) =>
  authorized<{
    cart: CartDTO;
    options: DeliveryOptionsDTO[];
    addresses: AddressDTO[];
  }>(baseUrl, "/v1/checkout", shopper);
export interface CheckoutChoice {
  deliveries: { storeSlug: string; method: DeliveryMethodDTO }[];
  addressId?: string;
}
export const quoteCheckout = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: CheckoutChoice,
) =>
  authorized<QuoteDTO>(baseUrl, "/v1/checkout/quote", sessionToken, {
    origin,
    body,
  });
export const placeOrder = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: CheckoutChoice & {
    idempotencyKey: string;
    expectedTotalMinor: string;
    cgvVersion?: number;
  },
) =>
  authorized<OrderDTO>(baseUrl, "/v1/orders", sessionToken, { origin, body });
export const listOrders = (baseUrl: string, sessionToken: string) =>
  authorized<{ orders: OrderDTO[] }>(baseUrl, "/v1/orders", sessionToken);
export const getOrder = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
) =>
  authorized<OrderDTO>(
    baseUrl,
    `/v1/orders/${encodeURIComponent(orderId)}`,
    sessionToken,
  );
export const cancelOrder = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  orderId: string,
) =>
  authorized<{ status: "CANCELLED" }>(
    baseUrl,
    `/v1/orders/${encodeURIComponent(orderId)}/cancel`,
    sessionToken,
    { origin, body: {} },
  );
export const listAddresses = (baseUrl: string, sessionToken: string) =>
  authorized<{ addresses: AddressDTO[] }>(
    baseUrl,
    "/v1/addresses",
    sessionToken,
  );
export const createAddress = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: Record<string, string | number>,
) =>
  authorized<AddressDTO>(baseUrl, "/v1/addresses", sessionToken, {
    origin,
    body,
  });
export async function archiveAddress(
  baseUrl: string,
  sessionToken: string,
  origin: string,
  addressId: string,
): Promise<boolean> {
  const response = await fetch(
    new URL(`/v1/addresses/${encodeURIComponent(addressId)}/archive`, baseUrl),
    {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${sessionToken}`, origin },
      cache: "no-store",
    },
  );
  return response.status === 204;
}
export const listSellerOrders = (
  baseUrl: string,
  sessionToken: string,
  storeId: string,
) =>
  authorized<{
    orders: (SellerOrderDTO & {
      orderId: string;
      createdAt: string;
      deliveryContact: DeliveryContactDTO | null;
      handoverLocked: boolean;
    })[];
  }>(baseUrl, `/v1/stores/${store(storeId)}/orders`, sessionToken);
export const updateFulfilment = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  body: {
    deliveryFeeMinor: string | null;
    pickupEnabled: boolean;
    pickupInstructions?: string;
    expectedVersion: number;
  },
) =>
  authorized<{ version: number }>(
    baseUrl,
    `/v1/stores/${store(storeId)}/fulfilment`,
    sessionToken,
    { origin, body },
  );
// ---------- Paiements (B06) ----------
export const listPaymentMethods = (
  baseUrl: string,
  sessionToken: string,
  orderId: string,
) =>
  authorized<{ methods: PaymentMethodOptionDTO[] }>(
    baseUrl,
    `/v1/orders/${encodeURIComponent(orderId)}/payment-methods`,
    sessionToken,
  );
export const startPayment = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  orderId: string,
  body: { methodCode: string; idempotencyKey: string; payerPhone?: string },
) =>
  authorized<PaymentDTO>(
    baseUrl,
    `/v1/orders/${encodeURIComponent(orderId)}/payments`,
    sessionToken,
    { origin, body },
  );
// Mode MOCK seulement (route absente ailleurs : 404).
export const simulatePayment = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  paymentId: string,
  outcome: "SUCCEEDED" | "FAILED",
) =>
  authorized<{ outcome: string }>(
    baseUrl,
    `/v1/payments/${encodeURIComponent(paymentId)}/simulate`,
    sessionToken,
    { origin, body: { outcome } },
  );
export const getAdminPaymentMethods = (baseUrl: string, sessionToken: string) =>
  authorized<{
    methods: AdminPaymentMethodDTO[];
    providers: { key: string; mode: PaymentModeDTO }[];
  }>(baseUrl, "/v1/admin/payment-methods", sessionToken);
export interface PaymentMethodInput {
  kind: AdminPaymentMethodDTO["kind"];
  operator: string;
  provider: string;
  countryCode: string;
  currency: string;
  labelFr: string;
  labelEn: string;
  instructionsFr: string;
  instructionsEn: string;
  phonePrefixes: string[];
  minAmountMinor: string;
  maxAmountMinor: string;
  displayOrder: number;
  enabled: boolean;
}
export const createPaymentMethod = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: PaymentMethodInput & { code: string },
) =>
  authorized<AdminPaymentMethodDTO>(
    baseUrl,
    "/v1/admin/payment-methods",
    sessionToken,
    { origin, body },
  );
export const updatePaymentMethod = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  methodId: string,
  body: PaymentMethodInput & { expectedVersion: number },
) =>
  authorized<AdminPaymentMethodDTO>(
    baseUrl,
    `/v1/admin/payment-methods/${encodeURIComponent(methodId)}`,
    sessionToken,
    { origin, body },
  );
export const getAdminPayments = (baseUrl: string, sessionToken: string) =>
  authorized<{
    payments: AdminPaymentDTO[];
    events: AdminProviderEventDTO[];
    refunds: {
      id: string;
      orderId: string;
      paymentId: string | null;
      amount: MoneyDTO;
      createdAt: string;
    }[];
  }>(baseUrl, "/v1/admin/payments", sessionToken);
// ---------- Livraison et notifications (B07) ----------
export const advanceFulfilment = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  sellerOrderId: string,
  body: { to: string; note?: string; code?: string; expectedVersion: number },
) =>
  authorized<{ status: string }>(
    baseUrl,
    `/v1/stores/${store(storeId)}/orders/${encodeURIComponent(sellerOrderId)}/fulfilment`,
    sessionToken,
    { origin, body },
  );
export const getNotifications = (baseUrl: string, sessionToken: string) =>
  authorized<{ unread: number; notifications: NotificationDTO[] }>(
    baseUrl,
    "/v1/notifications",
    sessionToken,
  );
export const markNotificationsRead = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
) =>
  authorized<{ marked: number }>(
    baseUrl,
    "/v1/notifications/read",
    sessionToken,
    { origin, body: {} },
  );
// ---------- Finance (B08) ----------
export const getCommissionRules = (baseUrl: string, sessionToken: string) =>
  authorized<{
    rules: CommissionRuleDTO[];
    stores: { id: string; name: string; slug: string }[];
    canConfigure: boolean;
  }>(baseUrl, "/v1/admin/commission-rules", sessionToken);
export const createCommissionRule = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: {
    storeId?: string;
    basisPoints: number;
    label: string;
    validFrom: string;
  },
) =>
  authorized<CommissionRuleDTO>(
    baseUrl,
    "/v1/admin/commission-rules",
    sessionToken,
    { origin, body },
  );
export const closeCommissionRule = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  ruleId: string,
  validTo: string,
) =>
  authorized<{ validTo: string }>(
    baseUrl,
    `/v1/admin/commission-rules/${encodeURIComponent(ruleId)}/close`,
    sessionToken,
    { origin, body: { validTo } },
  );
export const updateStoreContact = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  body: { phone: string | null; email: string | null },
) =>
  authorized<{ phone: string | null; email: string | null }>(
    baseUrl,
    `/v1/stores/${encodeURIComponent(storeId)}/contact`,
    sessionToken,
    { origin, body },
  );
export async function getDeliveryZones(
  baseUrl: string,
): Promise<DeliveryZoneDTO[]> {
  const response = await fetch(new URL("/v1/delivery-zones", baseUrl), {
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Zones request failed with status ${response.status}`);
  return ((await response.json()) as { zones: DeliveryZoneDTO[] }).zones;
}
export const getAdminZones = (baseUrl: string, sessionToken: string) =>
  authorized<{ zones: DeliveryZoneDTO[] }>(
    baseUrl,
    "/v1/admin/delivery-zones",
    sessionToken,
  );
export const createZone = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: { slug: string; city: string; name: string; position?: number },
) =>
  authorized<DeliveryZoneDTO>(
    baseUrl,
    "/v1/admin/delivery-zones",
    sessionToken,
    { origin, body },
  );
export const updateZone = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  zoneId: string,
  body: { name?: string; position?: number; active?: boolean },
) =>
  authorized<DeliveryZoneDTO>(
    baseUrl,
    `/v1/admin/delivery-zones/${encodeURIComponent(zoneId)}`,
    sessionToken,
    { origin, body },
  );
export const updateZoneFees = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  fees: StoreZoneFeeDTO[],
) =>
  authorized<{ count: number }>(
    baseUrl,
    `/v1/stores/${encodeURIComponent(storeId)}/zone-fees`,
    sessionToken,
    { origin, body: { fees } },
  );
// ---------- Données personnelles (lot 2) ----------
export type LegalKind = "CGU" | "CGV" | "PRIVACY" | "MARKETING";
export interface LegalTextDTO {
  kind: LegalKind;
  version: number;
  locale: string;
  title: string;
  body: string;
  sha256: string;
  effectiveFrom: string;
}
export interface MyPrivacyDTO {
  pending: { kind: LegalKind; version: number }[];
  marketing: { version: number | null; granted: boolean };
  consents: {
    kind: LegalKind;
    version: number;
    granted: boolean;
    source: string;
    createdAt: string;
  }[];
  requests: {
    id: string;
    kind: "RECTIFICATION" | "ERASURE" | "OTHER";
    message: string;
    status: "OPEN" | "IN_PROGRESS" | "DONE" | "REJECTED";
    dueAt: string;
    resolution: string | null;
    createdAt: string;
    closedAt: string | null;
  }[];
}
export interface AdminDataRequestDTO {
  id: string;
  userId: string;
  kind: "RECTIFICATION" | "ERASURE" | "OTHER";
  message: string;
  status: "OPEN" | "IN_PROGRESS" | "DONE" | "REJECTED";
  dueAt: string;
  overdue: boolean;
  resolution: string | null;
  createdAt: string;
  closedAt: string | null;
}
export async function getLegalTexts(
  baseUrl: string,
  locale: "fr" | "en",
): Promise<LegalTextDTO[]> {
  const response = await fetch(
    new URL(`/v1/legal/current?${new URLSearchParams({ locale })}`, baseUrl),
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(`Legal request failed with status ${response.status}`);
  return ((await response.json()) as { documents: LegalTextDTO[] }).documents;
}
export const getMyPrivacy = (baseUrl: string, sessionToken: string) =>
  authorized<MyPrivacyDTO>(baseUrl, "/v1/me/privacy", sessionToken);
export const recordConsent = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: { kind: LegalKind; version: number; granted: boolean; source: string },
) =>
  authorized<{ outcome: string }>(baseUrl, "/v1/me/consents", sessionToken, {
    origin,
    body,
  });
export const openDataRequest = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: { kind: string; message: string },
) =>
  authorized<{ id: string }>(baseUrl, "/v1/me/data-requests", sessionToken, {
    origin,
    body,
  });
export const getDataRequests = (baseUrl: string, sessionToken: string) =>
  authorized<{ canErase: boolean; requests: AdminDataRequestDTO[] }>(
    baseUrl,
    "/v1/admin/data-requests",
    sessionToken,
  );
export const updateDataRequest = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  requestId: string,
  body: { status: string; resolution?: string },
) =>
  authorized<{ outcome: string }>(
    baseUrl,
    `/v1/admin/data-requests/${encodeURIComponent(requestId)}`,
    sessionToken,
    { origin, body },
  );
export const eraseDataRequest = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  requestId: string,
  resolution: string,
) =>
  authorized<{ outcome: string }>(
    baseUrl,
    `/v1/admin/data-requests/${encodeURIComponent(requestId)}/erase`,
    sessionToken,
    { origin, body: { resolution } },
  );
export const getLegalDocuments = (baseUrl: string, sessionToken: string) =>
  authorized<{
    documents: {
      id: string;
      kind: LegalKind;
      version: number;
      locale: string;
      title: string;
      sha256: string;
      effectiveFrom: string;
    }[];
  }>(baseUrl, "/v1/admin/legal-documents", sessionToken);
export const publishLegalDocument = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: {
    kind: LegalKind;
    version: number;
    locale: string;
    title: string;
    body: string;
    effectiveFrom: string;
  },
) =>
  authorized<{ id: string }>(
    baseUrl,
    "/v1/admin/legal-documents",
    sessionToken,
    { origin, body },
  );
export const revealOwnerContact = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  reason: string,
) =>
  authorized<{ ownerName: string | null; ownerPhone: string | null }>(
    baseUrl,
    `/v1/admin/stores/${encodeURIComponent(storeId)}/owner-contact`,
    sessionToken,
    { origin, body: { reason } },
  );
export const getAccessLog = (baseUrl: string, sessionToken: string) =>
  authorized<{
    entries: {
      id: string;
      actorId: string;
      resource: string;
      resourceId: string;
      reason: string;
      createdAt: string;
    }[];
  }>(baseUrl, "/v1/admin/access-log", sessionToken);
export interface PaymentAccountsDTO {
  collectionMode: "PLATFORM_HELD" | "DIRECT_SELLER" | "PSP_ESCROW";
  providers: string[];
  accounts: {
    id: string;
    provider: string;
    mode: "SANDBOX" | "LIVE" | "MOCK";
    active: boolean;
    updatedAt: string;
  }[];
}
export const getPaymentAccounts = (
  baseUrl: string,
  sessionToken: string,
  storeId: string,
) =>
  authorized<PaymentAccountsDTO>(
    baseUrl,
    `/v1/stores/${encodeURIComponent(storeId)}/payment-account`,
    sessionToken,
  );
export const savePaymentAccount = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  body: {
    provider: string;
    mode: string;
    credentials: Record<string, string>;
  },
) =>
  authorized<{ id: string; notifyUrl: string }>(
    baseUrl,
    `/v1/stores/${encodeURIComponent(storeId)}/payment-account`,
    sessionToken,
    { origin, body },
  );
export interface CollectionAuthorizationsDTO {
  mode: "PLATFORM_HELD" | "DIRECT_SELLER" | "PSP_ESCROW";
  role: string;
  authorizations: {
    id: string;
    mode: string;
    agrementReference: string;
    expiresAt: string;
    requestedAt: string;
    approvedAt: string | null;
    revokedAt: string | null;
    requestedByMe: boolean;
  }[];
}
export const getCollectionAuthorizations = (
  baseUrl: string,
  sessionToken: string,
) =>
  authorized<CollectionAuthorizationsDTO>(
    baseUrl,
    "/v1/admin/collection-authorizations",
    sessionToken,
  );
export const requestCollectionAuthorization = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: { mode: string; agrementReference: string; expiresAt: string },
) =>
  authorized<{ id: string }>(
    baseUrl,
    "/v1/admin/collection-authorizations",
    sessionToken,
    { origin, body },
  );
export const approveCollectionAuthorization = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  id: string,
) =>
  authorized<{ outcome: string }>(
    baseUrl,
    `/v1/admin/collection-authorizations/${encodeURIComponent(id)}/approve`,
    sessionToken,
    { origin, body: {} },
  );
export const getParameters = (baseUrl: string, sessionToken: string) =>
  authorized<ParametersDTO>(baseUrl, "/v1/admin/parameters", sessionToken);
export const proposeParameter = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: {
    key: string;
    storeId?: string;
    value: string;
    effectiveFrom: string;
    legalBasis?: string;
    validated: boolean;
  },
) =>
  authorized<{ id: string }>(baseUrl, "/v1/admin/parameters", sessionToken, {
    origin,
    body,
  });
export const decideParameter = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  parameterId: string,
  body: { approve: boolean; reason?: string },
) =>
  authorized<{ outcome: string }>(
    baseUrl,
    `/v1/admin/parameters/${encodeURIComponent(parameterId)}/decide`,
    sessionToken,
    { origin, body },
  );
export const getFinanceReport = (
  baseUrl: string,
  sessionToken: string,
  period: { from?: string; to?: string },
) =>
  authorized<FinanceReportDTO>(
    baseUrl,
    `/v1/admin/finance?${new URLSearchParams(
      Object.entries(period).filter((e): e is [string, string] =>
        Boolean(e[1]),
      ),
    )}`,
    sessionToken,
  );
export const getEarnings = (
  baseUrl: string,
  sessionToken: string,
  storeId: string,
) =>
  authorized<EarningsDTO>(
    baseUrl,
    `/v1/stores/${store(storeId)}/earnings`,
    sessionToken,
  );
// ---------- Retours et litiges (B09) ----------
export const openClaim = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  orderId: string,
  body: {
    sellerOrderId: string;
    reason: ClaimReasonDTO;
    description: string;
    items: { orderItemId: string; quantity: number }[];
    idempotencyKey: string;
  },
) =>
  authorized<ClaimDTO>(
    baseUrl,
    `/v1/orders/${encodeURIComponent(orderId)}/claims`,
    sessionToken,
    { origin, body },
  );
export const claimAction = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  claimId: string,
  action: "escalate" | "withdraw",
) =>
  authorized<{ status: string }>(
    baseUrl,
    `/v1/claims/${encodeURIComponent(claimId)}/${action}`,
    sessionToken,
    { origin, body: {} },
  );
export const listStoreClaims = (
  baseUrl: string,
  sessionToken: string,
  storeId: string,
) =>
  authorized<{ claims: ClaimDTO[]; canRespond: boolean }>(
    baseUrl,
    `/v1/stores/${store(storeId)}/claims`,
    sessionToken,
  );
export const respondClaim = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  claimId: string,
  body: { accept: boolean; note?: string; expectedVersion: number },
) =>
  authorized<{ status: string }>(
    baseUrl,
    `/v1/stores/${store(storeId)}/claims/${encodeURIComponent(claimId)}/respond`,
    sessionToken,
    { origin, body },
  );
export const listAdminClaims = (
  baseUrl: string,
  sessionToken: string,
  status: string,
) =>
  authorized<{ status: string; claims: ClaimDTO[]; canDecide: boolean }>(
    baseUrl,
    `/v1/admin/claims?${new URLSearchParams({ status })}`,
    sessionToken,
  );
export const decideClaim = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  claimId: string,
  body: { refund: boolean; note: string },
) =>
  authorized<{ status: string }>(
    baseUrl,
    `/v1/admin/claims/${encodeURIComponent(claimId)}/mediate`,
    sessionToken,
    { origin, body },
  );
// ---------- Catégories ----------
// Lecture publique : aucun cookie transmis.
export async function getCategories(
  baseUrl: string,
  lang: "fr" | "en",
): Promise<CategoryDTO[]> {
  const response = await fetch(
    new URL(`/v1/catalog/categories?${new URLSearchParams({ lang })}`, baseUrl),
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(`Categories request failed with status ${response.status}`);
  return ((await response.json()) as { categories: CategoryDTO[] }).categories;
}
export const setProductCategory = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  productId: string,
  categoryId: string | null,
) =>
  authorized<ProductDTO>(
    baseUrl,
    `/v1/stores/${store(storeId)}/products/${encodeURIComponent(productId)}/category`,
    sessionToken,
    { origin, body: { categoryId } },
  );
export const getAdminCategories = (baseUrl: string, sessionToken: string) =>
  authorized<{ categories: AdminCategoryDTO[] }>(
    baseUrl,
    "/v1/admin/categories",
    sessionToken,
  );
export const createCategory = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  body: {
    slug: string;
    parentId?: string;
    nameFr: string;
    nameEn: string;
    position?: number;
  },
) =>
  authorized<AdminCategoryDTO>(baseUrl, "/v1/admin/categories", sessionToken, {
    origin,
    body,
  });
export const updateCategory = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  categoryId: string,
  body: { nameFr: string; nameEn: string; position: number; active: boolean },
) =>
  authorized<AdminCategoryDTO>(
    baseUrl,
    `/v1/admin/categories/${encodeURIComponent(categoryId)}`,
    sessionToken,
    { origin, body },
  );
export async function logout(
  baseUrl: string,
  sessionToken: string,
  origin: string,
): Promise<void> {
  const response = await fetch(new URL("/v1/auth/logout", baseUrl), {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE}=${sessionToken}`, origin },
  });
  if (response.status !== 204 && response.status !== 401)
    throw new Error(`Logout failed with status ${response.status}`);
}
