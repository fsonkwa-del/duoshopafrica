import { createDatabase } from "@duoshop/database";
import { storageFromEnv } from "@duoshop/media";
import { collectionFromEnv, providersFromEnv } from "@duoshop/payments";
import { createApp } from "./app.js";
import { assertCollectionMode } from "./collection.js";
import { oidcSettingsFromEnv } from "./oidc.js";

const port = Number(process.env.API_PORT ?? 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid API_PORT");
const db = createDatabase();
const oidc = oidcSettingsFromEnv(process.env);
const storage = storageFromEnv(process.env);
const providers = providersFromEnv(process.env);
// Mode d'encaissement (lot 3) : refus de démarrer si le mode n'est pas servi ou pas autorisé.
const collection = collectionFromEnv(process.env);
await assertCollectionMode(db, collection, providers, process.env);
const devLogin = process.env.DEV_LOGIN_ENABLED === "true";
const trustProxy = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 5)
  throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 5");
if (devLogin && process.env.NODE_ENV === "production")
  throw new Error("DEV_LOGIN_ENABLED is forbidden in production");
const app = await createApp({
  logger: true,
  db,
  ...(process.env.WEB_ORIGIN ? { webOrigin: process.env.WEB_ORIGIN } : {}),
  ...(oidc ? { oidc } : {}),
  ...(storage ? { storage } : {}),
  providers,
  collection,
  devLogin,
  trustProxy,
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
