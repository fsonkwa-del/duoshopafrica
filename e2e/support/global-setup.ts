import { writeFileSync } from "node:fs";
import { seed } from "./db";

export default async function globalSetup() {
  const data = await seed();
  writeFileSync(".local/e2e-seed.json", JSON.stringify(data));
  // Pool laissé ouvert (allowExitOnIdle) : le nettoyage final s'exécute dans le même processus.
}
