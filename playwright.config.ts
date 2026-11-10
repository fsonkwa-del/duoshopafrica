import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// E2E sur les builds de production (pnpm build au préalable) : API (adaptateur de paiement MOCK,
// jamais en production réelle) et site Next en `next start`. Données créées puis supprimées.
const web = "http://localhost:3000";
export default defineConfig({
  testDir: "e2e",
  outputDir: ".local/e2e-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // En CI, les échecs deviennent aussi des annotations GitHub (lisibles sans connexion).
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  globalSetup: "./e2e/support/global-setup.ts",
  globalTeardown: "./e2e/support/global-teardown.ts",
  use: {
    baseURL: web,
    locale: "fr-FR",
    timezoneId: "Africa/Douala",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "node dist/main.js",
      cwd: "apps/api",
      // Journaux de l'API visibles (erreurs reprises en annotation CI en cas d'échec).
      stdout: "pipe",
      url: "http://127.0.0.1:4000/health/ready",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        WEB_ORIGIN: web,
        PAYMENTS_MOCK_ENABLED: "true",
        // Photos du catalogue de démonstration, servies par le site (apps/web/public).
        MEDIA_PUBLIC_BASE_URL: web,
        PAYMENTS_MOCK_SECRET: randomBytes(24).toString("hex"),
      },
    },
    {
      command: "npx next start -p 3000",
      cwd: "apps/web",
      url: `${web}/fr`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_INTERNAL_URL: "http://127.0.0.1:4000", WEB_ORIGIN: web },
    },
  ],
});
