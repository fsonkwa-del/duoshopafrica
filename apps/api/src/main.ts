import { createDatabase } from "@duoshop/database";
import { storageFromEnv } from "@duoshop/media";
import { providersFromEnv } from "@duoshop/payments";
import { createApp } from "./app.js";
import { oidcSettingsFromEnv } from "./oidc.js";

const port = Number(process.env.API_PORT ?? 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid API_PORT");
const db = createDatabase();
const oidc = oidcSettingsFromEnv(process.env);
const storage = storageFromEnv(process.env);
const providers = providersFromEnv(process.env);
const devLogin = process.env.DEV_LOGIN_ENABLED === "true";
if (devLogin && process.env.NODE_ENV === "production")
  throw new Error("DEV_LOGIN_ENABLED is forbidden in production");
const app = await createApp({
  logger: true,
  db,
  ...(process.env.WEB_ORIGIN ? { webOrigin: process.env.WEB_ORIGIN } : {}),
  ...(oidc ? { oidc } : {}),
  ...(storage ? { storage } : {}),
  providers,
  devLogin,
  ...(process.env.MEDIA_PUBLIC_BASE_URL
    ? { mediaBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL }
    : {}),
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await app.close();
    await db.$disconnect();
  });
await app.listen({ port, host: process.env.API_HOST ?? "127.0.0.1" });
