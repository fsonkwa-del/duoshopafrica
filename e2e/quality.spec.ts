import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { session } from "./support/db";
import {
  deviceOptions,
  expectFitsScreen,
  seedData,
  signIn,
} from "./support/fixtures";

// Fiche produit résolue à l'exécution (données créées par la préparation globale).
const publicPages = [
  "/fr",
  "/en",
  "/fr/products",
  "/fr/products?category=mode",
  "product",
  "/fr/cart",
  "/fr/checkout",
];
const resolve = (path: string) =>
  path === "product" ? `/fr/products/${seedData().productId}` : path;

// Accessibilité automatisée (axe, WCAG 2.1 A/AA) : aucune violation grave ou critique.
// Ce contrôle ne remplace pas une recette manuelle (lecteur d'écran, clavier).
for (const path of publicPages)
  test(`accessibility: ${path}`, async ({ page }) => {
    await page.goto(resolve(path));
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      blocking.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`),
    ).toEqual([]);
  });

// Écran étroit : aucun défilement horizontal parasite.
for (const path of publicPages)
  test(`layout fits the screen: ${path}`, async ({ page }) => {
    await page.goto(resolve(path));
    await expectFitsScreen(page);
  });

test("English pages are translated", async ({ page }) => {
  await page.goto("/en");
  await expect(
    page.getByRole("heading", { level: 1, name: /Welcome to DuoShopAfrica/ }),
  ).toBeVisible();
  await expect(page.locator(".lang-switch")).toContainText("English · XAF");
});

test("production hardening: no demo sign-in, security headers", async ({
  page,
  request,
}) => {
  const devLogin = await page.goto("/fr/dev-login");
  expect(devLogin?.status()).toBe(404);
  const home = await request.get("/fr");
  expect(home.headers()["x-frame-options"]).toBe("DENY");
  expect(home.headers()["x-content-type-options"]).toBe("nosniff");
  expect(home.headers()["x-powered-by"]).toBeUndefined();
  const csp = home.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(
    /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
  );
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
});

// Les scripts de Next portent le nonce : aucun blocage CSP, y compris sur la seule page qui
// exécute un composant client (envoi de photos du catalogue vendeur).
test("the content security policy blocks nothing legitimate", async ({
  browser,
}) => {
  const context = await browser.newContext(deviceOptions());
  await signIn(context, seedData().sellerToken);
  const page = await context.newPage();
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text()))
      violations.push(message.text());
  });
  for (const path of [
    "/fr",
    `/fr/products/${seedData().productId}`,
    `/fr/account/stores/${seedData().storeId}/catalog`,
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(violations).toEqual([]);
  expect(await page.locator("script[nonce]").count()).toBeGreaterThan(0);
});

test("a buyer never reaches platform administration", async ({ browser }) => {
  const context = await browser.newContext(deviceOptions());
  await signIn(context, await session("e2e-curious@example.invalid"));
  const page = await context.newPage();
  for (const path of [
    "/fr/admin/verifications",
    "/fr/admin/finance",
    "/fr/admin/claims",
    "/fr/admin/parameters",
  ]) {
    await page.goto(resolve(path));
    await expect(
      page.getByText("Page réservée au personnel de la plateforme."),
    ).toBeVisible();
  }
});

test("an admin without the finance role cannot change commission rules", async ({
  browser,
}) => {
  const context = await browser.newContext(deviceOptions());
  await signIn(context, seedData().adminToken);
  const page = await context.newPage();
  await page.goto("/fr/admin/commissions");
  await expect(
    page.getByText("Lecture seule : seul le rôle Finance modifie les règles."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Créer la règle" }),
  ).toHaveCount(0);
});

test("an admin sees the dated regulatory parameters and may only propose a value", async ({
  browser,
}) => {
  const context = await browser.newContext(deviceOptions());
  await signIn(context, seedData().adminToken);
  const page = await context.newPage();
  await page.goto("/fr/admin/parameters");
  await expect(
    page.getByRole("heading", { name: "Paramètres réglementaires", level: 1 }),
  ).toBeVisible();
  const claims = page.getByRole("row", {
    name: /Délai de réclamation après la remise/,
  });
  await expect(claims).toContainText("7 days");
  await expect(claims).toContainText("À valider");
  await expect(
    page.getByRole("button", { name: "Soumettre pour approbation" }),
  ).toBeVisible();
  await expectFitsScreen(page);
});

test("shoppers browse by category, down to sub-categories, with a breadcrumb", async ({
  page,
}) => {
  const seed = seedData();
  await page.goto("/fr");
  const nav = page.getByRole("navigation", { name: "Catégories", exact: true });
  await nav.getByRole("link", { name: /Mode et pagnes/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Mode et pagnes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: seed.productTitle }),
  ).toBeVisible();
  await nav.getByRole("link", { name: /Tissus et pagnes/ }).click();
  const crumbs = page.locator(".breadcrumb");
  await expect(crumbs).toContainText("Accueil");
  await expect(crumbs).toContainText("Mode et pagnes");
  await expect(crumbs).toContainText("Tissus et pagnes");
  await expectFitsScreen(page);
  await page.getByRole("link", { name: seed.productTitle }).click();
  await expect(
    page.locator(".breadcrumb").getByRole("link", { name: "Tissus et pagnes" }),
  ).toBeVisible();
  await page.goto("/fr");
  await nav.getByRole("link", { name: /Alimentation/ }).click();
  await expect(page.getByRole("link", { name: seed.productTitle })).toHaveCount(
    0,
  );
});

test("the whole product card opens the product page, not only its title", async ({
  page,
}) => {
  const seed = seedData();
  await page.goto("/fr/products?category=tissus-pagnes");
  const card = page
    .locator(".product-card")
    .filter({ hasText: seed.productTitle });
  // Vrai clic aux coordonnées du prix (hors du titre) : le lien recouvre toute la carte,
  // c'est donc lui qui reçoit le clic et mène à la fiche.
  await card.scrollIntoViewIfNeeded();
  const box = await card.locator(".price").boundingBox();
  if (!box) throw new Error("price not rendered");
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await expect(page).toHaveURL(new RegExp(`/fr/products/${seed.productId}$`));
});

test("the product page shows the seller, guarantees and specifications", async ({
  page,
}) => {
  const seed = seedData();
  await page.goto(`/fr/products/${seed.productId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: seed.productTitle }),
  ).toBeVisible();
  const seller = page.getByRole("region", { name: "Vendeur" });
  await expect(seller).toContainText("Boutique E2E");
  await expect(seller).toContainText("Boutique vérifiée par la plateforme");
  await expect(seller).toContainText("Marché Central, stand 7");
  await expect(
    page.getByRole("region", { name: "Vos garanties" }),
  ).toContainText("7 jours");
  const specs = page.getByRole("region", { name: "Caractéristiques" });
  await expect(specs).toContainText("Mode et pagnes › Tissus et pagnes");
  await expect(specs).toContainText("2 mètres");
  await expectFitsScreen(page);
});

test("Buy now adds to the cart and goes straight to checkout", async ({
  browser,
}) => {
  const context = await browser.newContext(deviceOptions());
  const page = await context.newPage();
  await page.goto(`/fr/products/${seedData().productId}`);
  await page.getByRole("button", { name: "Acheter maintenant" }).click();
  await expect(page).toHaveURL(/\/fr\/checkout$/);
  await expect(
    page.getByRole("heading", { name: "Étape 1 : votre compte client" }),
  ).toBeVisible();
});

test("the featured carousel sits below the search and can be browsed", async ({
  page,
}) => {
  await page.goto("/fr");
  const carousel = page.getByRole("region", { name: "À la une" });
  await expect(carousel).toBeVisible();
  await expect(carousel.locator(".promo-slide")).toHaveCount(3);
  const dots = carousel.locator(".promo-dots a");
  await expect(dots.nth(0)).toHaveAttribute("aria-current", "true");
  await carousel.getByRole("button", { name: "Diapositive suivante" }).click();
  await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
  // Placé sous la zone de recherche.
  const search = await page.locator(".big-search").boundingBox();
  const box = await carousel.boundingBox();
  expect(box && search && box.y > search.y + search.height).toBe(true);
  await expectFitsScreen(page);
});

test("the language and currency picker switches language on the same page", async ({
  page,
}) => {
  const seed = seedData();
  await page.goto(`/fr/products/${seed.productId}`);
  await page.locator(".lang-switch").click();
  const panel = page.locator(".lang-panel");
  await expect(
    panel.getByText("Sélectionnez une langue et une devise"),
  ).toBeVisible();
  await expect(panel.getByLabel("Devise")).toHaveValue("XAF");
  await expectFitsScreen(page);
  await panel.getByLabel("Langue").selectOption("en");
  await panel.getByRole("button", { name: "Sauvegarder" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/products/${seed.productId}$`));
  await expect(page.getByRole("button", { name: "Buy now" })).toBeVisible();
});

test("back-office pages use the full width with a framed side menu", async ({
  browser,
}) => {
  const context = await browser.newContext(deviceOptions());
  await signIn(context, seedData().adminToken);
  const page = await context.newPage();
  await page.goto("/fr/admin/verifications");
  const menu = page.getByRole("navigation", { name: "Administration" });
  await expect(menu).toBeVisible();
  await expect(menu.locator('a[aria-current="page"]')).toHaveText(
    "Vérifications vendeurs",
  );
  // Menu encadré (fond blanc, bordure) et contenu sur toute la largeur utile.
  expect(await menu.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe(
    "solid",
  );
  const viewport = page.viewportSize()?.width ?? 0;
  const main = await page.locator("main").boundingBox();
  expect((main?.width ?? 0) / viewport).toBeGreaterThan(0.9);
  await expectFitsScreen(page);
});

test("a signed-in user opens a store, then is asked to request verification", async ({
  browser,
}) => {
  const context = await browser.newContext(deviceOptions());
  const suffix = Math.random().toString(36).slice(2, 8);
  await signIn(context, await session(`e2e-opener-${suffix}@example.invalid`));
  const page = await context.newPage();
  await page.goto(resolve("/fr/account"));
  await page.getByRole("link", { name: "Ouvrir ma boutique" }).click();
  await expect(
    page.getByRole("heading", { name: "Ouvrir ma boutique" }),
  ).toBeVisible();
  await expectFitsScreen(page);
  // Nom « TEST-E2E » : l'organisation créée est supprimée par le nettoyage des tests.
  await page.getByLabel("Nom de la boutique").fill("TEST-E2E");
  await page.getByLabel("Adresse de la boutique").fill(`e2e-shop-${suffix}`);
  await page.getByRole("button", { name: "Créer la boutique" }).click();
  await expect(page.getByText("Boutique créée.")).toBeVisible();
  await expect(page.getByText(`e2e-shop-${suffix}`)).toBeVisible();
  // Même adresse une seconde fois : refus explicite.
  await page.goto(resolve("/fr/account/stores/new"));
  await page.getByLabel("Nom de la boutique").fill("TEST-E2E");
  await page.getByLabel("Adresse de la boutique").fill(`e2e-shop-${suffix}`);
  await page.getByRole("button", { name: "Créer la boutique" }).click();
  await expect(page.getByText("Cette adresse est déjà prise")).toBeVisible();
  await context.close();
});
