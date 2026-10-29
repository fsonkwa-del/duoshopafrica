import { randomBytes } from "node:crypto";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { handoverCode, session } from "./support/db";
import {
  deviceOptions,
  expectFitsScreen,
  seedData,
  signIn,
} from "./support/fixtures";

// Parcours complet d'un pilote, dans un vrai navigateur (mobile et bureau) :
// visiteur → panier → compte au checkout → adresse saisie sur place → paiement (MOCK)
// → préparation et remise contre code → réclamation et remboursement décidé.
test.describe.configure({ mode: "serial" });

let seed: ReturnType<typeof seedData>;
let buyerPage: Page;
test.beforeAll(() => {
  seed = seedData();
});
let orderUrl = "";

async function sellerPage(browser: Browser) {
  const context = await browser.newContext(deviceOptions());
  await signIn(context, seed.sellerToken);
  return context.newPage();
}

test("a visitor finds the product from the home page and fills a cart without an account", async ({
  browser,
}) => {
  const context = await browser.newContext(deviceOptions());
  buyerPage = await context.newPage();
  const page = buyerPage;
  await page.goto("/fr");
  await expect(
    page.getByRole("heading", { level: 1, name: /boutiques de Douala/ }),
  ).toBeVisible();
  await page.getByRole("searchbox").first().fill(seed.productTitle);
  await page.getByRole("searchbox").first().press("Enter");
  await page.getByRole("link", { name: seed.productTitle }).click();
  await page.getByRole("button", { name: "Ajouter au panier" }).click();
  await expect(page).toHaveURL(/ok=add/);
  await expect(
    page.getByRole("link", { name: /Panier : 1 articles/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Panier : 1/ }).click();
  await expect(page.getByText(/Pas encore de compte/)).toBeVisible();
  await page.getByRole("link", { name: "Passer la commande" }).click();
  await expect(
    page.getByRole("heading", { name: "Étape 1 : votre compte client" }),
  ).toBeVisible();
});

test("after creating an account, the cart follows and the address is entered at checkout", async () => {
  const page = buyerPage;
  // Inscription : simulée par une session neuve, comme au retour de Zitadel.
  const token = await session(
    `e2e-buyer-${randomBytes(3).toString("hex")}@example.invalid`,
  );
  await signIn(page.context(), token);
  await page.reload();
  await page.getByLabel("Livraison à domicile").check();
  await page.getByRole("button", { name: "Calculer le total" }).click();
  await page.getByLabel("Nom du destinataire").fill("Awa Ngono");
  await page.getByLabel(/Téléphone/).fill("699 12 34 56");
  await page.getByLabel("Quartier").fill("Bonamoussadi");
  await page
    .getByLabel(/Repère/)
    .fill("Derrière la station Total, portail bleu");
  await page.getByRole("button", { name: "Utiliser cette adresse" }).click();
  await expect(page.getByText(/6\s000\s?FCFA/).first()).toBeVisible();
  await expectFitsScreen(page);
  await page.getByRole("button", { name: "Confirmer la commande" }).click();
  await expect(page).toHaveURL(/\/fr\/orders\/[0-9a-f-]{36}/);
  orderUrl = page.url().split("?")[0] ?? "";
});

test("payment is confirmed only through the provider path, never by the browser", async () => {
  const page = buyerPage;
  await expect(page.getByText("En attente de paiement").first()).toBeVisible();
  await expectFitsScreen(page);
  await page.getByLabel(/Numéro qui va payer/).fill("699 00 00 00");
  await page.getByRole("button", { name: /Payer/ }).click();
  await expect(
    page.getByText("Ce numéro n'appartient pas à l'opérateur choisi."),
  ).toBeVisible();
  await page.getByLabel(/Numéro qui va payer/).fill("677 11 22 33");
  await page.getByRole("button", { name: /Payer/ }).click();
  await expect(page.getByText(/MODE TEST/).first()).toBeVisible();
  await page.getByRole("button", { name: /Simuler : validé/ }).click();
  await expect(
    page.getByText("Paiement confirmé par le prestataire."),
  ).toBeVisible();
  await expect(page.locator(".handover-code")).toHaveText(/^[0-9]{6}$/);
});

test("the seller prepares and hands over against the buyer's code", async ({
  browser,
}) => {
  const seller = await sellerPage(browser);
  await seller.goto(`/fr/account/stores/${seed.storeId}/orders`);
  await expect(seller.getByText("Awa Ngono").first()).toBeVisible();
  await expectFitsScreen(seller);
  await seller.getByRole("button", { name: "Marquer comme prête" }).click();
  await seller.getByRole("button", { name: "Partie en livraison" }).click();
  const orderId = orderUrl.split("/").pop() ?? "";
  await seller
    .getByLabel("Code à 6 chiffres donné par le client")
    .fill(await handoverCode(orderId));
  await seller.getByRole("button", { name: "Confirmer la remise" }).click();
  await expect(seller.getByText("Étape enregistrée.")).toBeVisible();
  await buyerPage.goto(orderUrl);
  await expect(buyerPage.getByText("Remise au client").first()).toBeVisible();
  await expect(buyerPage.locator(".handover-code")).toHaveCount(0);
});

test("a claim accepted by the seller becomes a refund awaiting the provider", async ({
  browser,
}) => {
  const page = buyerPage;
  await page.getByRole("link", { name: "Signaler un problème" }).click();
  await expectFitsScreen(page);
  await page
    .getByLabel(/Description du problème/)
    .fill("Le tissu présente une large tache à la réception.");
  await page.getByRole("button", { name: "Envoyer la réclamation" }).click();
  await expect(page.getByText("Réclamation envoyée au vendeur.")).toBeVisible();
  const seller = await sellerPage(browser);
  await seller.goto(`/fr/account/stores/${seed.storeId}/claims`);
  await expectFitsScreen(seller);
  await seller.getByRole("button", { name: "Accepter et rembourser" }).click();
  await expect(seller.getByText("Décision enregistrée.")).toBeVisible();
  await page.goto(orderUrl);
  await expect(
    page.getByText(/en attente d'exécution par le prestataire/),
  ).toBeVisible();
});
