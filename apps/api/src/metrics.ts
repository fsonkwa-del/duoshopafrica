import { createHash, timingSafeEqual } from "node:crypto";
import { asRuntime, type Database } from "@duoshop/database";
import type { FastifyInstance } from "fastify";

// Lot 8 (ADR 0016) : métriques d'exploitation au format Prometheus. Accès par jeton (METRICS_TOKEN),
// pas de session : la supervision auto-hébergée les lit. Aucune donnée personnelle, des compteurs.
const same = (a: string, b: string) =>
  timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );

export function prometheusText(metrics: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(metrics)) {
    if (name === "worker_heartbeats") continue;
    lines.push(
      `# TYPE duoshop_${name} gauge`,
      `duoshop_${name} ${Number(value)}`,
    );
  }
  const beats = (metrics.worker_heartbeats ?? {}) as Record<
    string,
    { age_seconds: number; failed: boolean }
  >;
  lines.push("# TYPE duoshop_worker_job_age_seconds gauge");
  for (const [job, b] of Object.entries(beats))
    lines.push(
      `duoshop_worker_job_age_seconds{job="${job}"} ${Number(b.age_seconds)}`,
    );
  lines.push("# TYPE duoshop_worker_job_failed gauge");
  for (const [job, b] of Object.entries(beats))
    lines.push(`duoshop_worker_job_failed{job="${job}"} ${b.failed ? 1 : 0}`);
  return `${lines.join("\n")}\n`;
}

export async function metricsRoutes(
  app: FastifyInstance,
  options: { db: Database; token?: string },
) {
  const { db, token } = options;
  app.get("/metrics", async (request, reply) => {
    const header = request.headers.authorization ?? "";
    // Sans jeton configuré, la route n'existe pas (404) : rien n'est exposé par défaut.
    if (!token) return reply.code(404).send({ error: "not_found" });
    if (!same(header, `Bearer ${token}`))
      return reply.code(401).send({ error: "unauthenticated" });
    const [row] = await asRuntime(
      db,
      {},
      (tx) =>
        tx.$queryRaw<
          { metrics: Record<string, unknown> }[]
        >`SELECT ops_metrics() AS metrics`,
    );
    return reply
      .type("text/plain; version=0.0.4")
      .header("cache-control", "no-store")
      .send(prometheusText(row?.metrics ?? {}));
  });
}
