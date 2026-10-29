import { cleanup, pool } from "./db";

export default async function globalTeardown() {
  await cleanup();
  await pool.end();
}
