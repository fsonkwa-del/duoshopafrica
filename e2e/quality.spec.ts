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
    page.getByRole("heading", { level: 1, name: /Douala's shops/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Français" })).toBeVisible();
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
});

test("a buyer never reaches platform administration", async ({ browser }) => {
  const context = await browser.newContext(deviceOptions());
  await signIn(context, await session("e2e-curious@example.invalid"));
  const page = await context.newPage();
  for (const path of [
    "/fr/admin/verifications",
    "/fr/admin/finance",
    "/fr/admin/claims",
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
