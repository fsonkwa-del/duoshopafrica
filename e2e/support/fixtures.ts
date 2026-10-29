import { readFileSync } from "node:fs";
import {
  type BrowserContext,
  type BrowserContextOptions,
  expect,
  type Page,
  test,
} from "@playwright/test";
import type { Seed } from "./db";

export const seedData = (): Seed =>
  JSON.parse(readFileSync(".local/e2e-seed.json", "utf8")) as Seed;

// Équivalent du retour de connexion OIDC : cookie de session httpOnly posé sur le site.
export async function signIn(context: BrowserContext, token: string) {
  await context.addCookies([
    {
      name: "__Host-session",
      value: token,
      // Préfixe __Host- : hôte exact, chemin racine, Secure (localhost est un contexte sécurisé).
      url: "https://localhost:3000",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

// La page tient dans la largeur de l'appareil. On compare à la largeur de l'écran émulé et non à
// window.innerWidth : un contenu trop large fait dézoomer le mobile, et innerWidth grandit avec lui.
export async function expectFitsScreen(page: Page) {
  const device = page.viewportSize()?.width ?? 0;
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `page width on a ${device}px screen`).toBeLessThanOrEqual(
    device,
  );
}

// Contexte supplémentaire (vendeur, admin…) émulant le même appareil que le projet en cours.
export function deviceOptions(): BrowserContextOptions {
  const use = test.info().project.use;
  return {
    ...(use.viewport ? { viewport: use.viewport } : {}),
    ...(use.userAgent ? { userAgent: use.userAgent } : {}),
    ...(use.deviceScaleFactor
      ? { deviceScaleFactor: use.deviceScaleFactor }
      : {}),
    isMobile: use.isMobile ?? false,
    hasTouch: use.hasTouch ?? false,
    baseURL: "http://localhost:3000",
    locale: "fr-FR",
    timezoneId: "Africa/Douala",
  };
}
