import {
  type AddressDTO,
  type AdminPaymentDTO,
  type AdminPaymentMethodDTO,
  type AdminProviderEventDTO,
  type AuditEntryDTO,
  CART_COOKIE,
  type CartDTO,
  type CatalogPageDTO,
  type CommissionRuleDTO,
  type DeliveryContactDTO,
  type DeliveryMethodDTO,
  type DeliveryOptionsDTO,
  type EarningsDTO,
  type FinanceReportDTO,
  type HealthResponse,
  type MeDTO,
  type MerchantDecisionDTO,
  type MoneyDTO,
  type NotificationDTO,
  type OrderDTO,
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
  type VerificationQueueItemDTO,
  type VerificationStatusDTO,
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
type Refusal = 400 | 401 | 403 | 404 | 409 | 429;
const refusals: readonly number[] = [400, 401, 403, 404, 409, 429];
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
export const submitVerification = (
  baseUrl: string,
  sessionToken: string,
  origin: string,
  storeId: string,
  body: { legalName: string; registrationNumber?: string },
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
  query: { q?: string; page?: number; lang: "fr" | "en" },
): Promise<CatalogPageDTO> {
  const params = new URLSearchParams({ lang: query.lang });
  if (query.q) params.set("q", query.q);
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
  body: CheckoutChoice & { idempotencyKey: string; expectedTotalMinor: string },
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
  authorized<{ payments: AdminPaymentDTO[]; events: AdminProviderEventDTO[] }>(
    baseUrl,
    "/v1/admin/payments",
    sessionToken,
  );
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
