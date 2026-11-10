import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createDatabase } from "@duoshop/database";
import { createApp } from "./app";

// Lot 8 (ADR 0016) : /metrics au format Prometheus, sur jeton, sans donnée personnelle.
const db = createDatabase({ max: 2 });
const token = randomUUID() + randomUUID();
const withToken = await createApp({ db, metricsToken: token });
const without = await createApp({ db });
// Nom de tâche en lettres seulement, comme les vraies tâches du worker.
const job = `test_${randomUUID()
  .replace(/[^a-f]/g, "")
  .slice(0, 12)}`;

after(async () => {
  await db.workerHeartbeat.deleteMany({ where: { job } });
  await withToken.close();
  await without.close();
  await db.$disconnect();
});

test("metrics exist only with a token and expose counters and worker heartbeats", async () => {
  assert.equal((await without.inject({ url: "/metrics" })).statusCode, 404);
  assert.equal(
    (
      await withToken.inject({
        url: "/metrics",
        headers: { authorization: "Bearer faux" },
      })
    ).statusCode,
    401,
  );
  await db.workerHeartbeat.create({
    data: {
      job,
      lastRunAt: new Date(Date.now() - 120_000),
      lastStatus: "failed",
    },
  });
  const res = await withToken.inject({
    url: "/metrics",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] as string, /text\/plain/);
  assert.match(res.body, /^duoshop_payments_pending_over_1h \d+$/m);
  assert.match(res.body, /^duoshop_unbalanced_journals 0$/m);
  assert.match(
    res.body,
    new RegExp(`duoshop_worker_job_failed\\{job="${job}"\\} 1`),
  );
  const age = Number(
    new RegExp(`duoshop_worker_job_age_seconds\\{job="${job}"\\} (\\d+)`).exec(
      res.body,
    )?.[1],
  );
  assert.ok(age >= 119 && age < 200, `${age}`);
  // Aucune adresse e-mail ni téléphone dans les métriques.
  assert.ok(!/@|\+237/.test(res.body));
});
