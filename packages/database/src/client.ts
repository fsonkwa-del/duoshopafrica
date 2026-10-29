import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { PrismaClient } from "../generated/client";

config({ path: "../../.env" });
export function createDatabase(pool: { max?: number } = {}) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      // L'adaptateur envoie les dates sans fuseau : la session DOIT être en UTC, sinon chaque
      // horodatage écrit par l'application est décalé du fuseau du serveur (cf. VALIDATION Sprint 4).
      options: "-c TimeZone=UTC",
      ...pool,
    }),
  });
}
