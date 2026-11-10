import { asRuntime, type Database, type ScopedTx } from "@duoshop/database";
import type { FastifyInstance, FastifyReply } from "fastify";
import PDFDocument from "pdfkit";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
} from "./guards";
import { requireStaff } from "./staff";

// Lot 2 (ADR 0010) : documents légaux versionnés, consentements, « Mes données » (export,
// demandes), traitement des demandes par le personnel, consultations sensibles journalisées.
// Les règles (version en vigueur, retrait, délais, anonymisation) sont dans les fonctions SQL.
const uuid = { type: "string", format: "uuid" } as const;
const kinds = ["CGU", "CGV", "PRIVACY", "MARKETING"] as const;
type Kind = (typeof kinds)[number];
const refusals = {
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
  428: error,
} as const;
const anyObject = { type: "object", additionalProperties: true } as const;
const iso = (d: Date | null) => d?.toISOString() ?? null;

// Données d'une personne telles que la RLS les lui montre : export fidèle à ce qu'elle voit.
async function personalData(tx: ScopedTx, userId: string) {
  const [user, consents, addresses, orders, claims, notifications, requests] =
    await Promise.all([
      tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, email: true, createdAt: true },
      }),
      tx.consent.findMany({ orderBy: { createdAt: "asc" } }),
      tx.address.findMany({ orderBy: { createdAt: "asc" } }),
      tx.order.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          sellerOrders: { include: { items: true } },
          payments: {
            select: {
              id: true,
              methodCode: true,
              status: true,
              amountMinor: true,
              currency: true,
              createdAt: true,
            },
          },
        },
      }),
      tx.claim.findMany({ orderBy: { createdAt: "asc" } }),
      tx.notification.findMany({ orderBy: { createdAt: "asc" } }),
      tx.dataRequest.findMany({ orderBy: { createdAt: "asc" } }),
    ]);
  // Montants en chaînes : le JSON ne porte pas de grands entiers.
  return JSON.parse(
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        user,
        consents,
        addresses,
        orders,
        claims,
        notifications,
        dataRequests: requests,
      },
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    ),
  ) as Record<string, unknown>;
}

function pdfOf(
  data: Record<string, unknown>,
  lang: "fr" | "en",
): Promise<Buffer> {
  const t =
    lang === "fr"
      ? {
          title: "Mes données — DuoShopAfrica",
          exported: "Exporté le",
          sections: {
            user: "Compte",
            consents: "Consentements",
            addresses: "Adresses",
            orders: "Commandes",
            claims: "Réclamations",
            notifications: "Notifications",
            dataRequests: "Demandes sur les données",
          },
          empty: "Aucune donnée.",
        }
      : {
          title: "My data — DuoShopAfrica",
          exported: "Exported on",
          sections: {
            user: "Account",
            consents: "Consents",
            addresses: "Addresses",
            orders: "Orders",
            claims: "Claims",
            notifications: "Notifications",
            dataRequests: "Data requests",
          },
          empty: "No data.",
        };
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: t.title },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(18).text(t.title);
    doc.fontSize(9).text(`${t.exported} ${String(data.exportedAt)}`);
    for (const [key, label] of Object.entries(t.sections)) {
      const value = data[key];
      doc.moveDown().fontSize(13).text(label);
      const rows = Array.isArray(value) ? value : [value];
      if (rows.length === 0 || value == null) {
        doc.fontSize(9).text(t.empty);
        continue;
      }
      for (const row of rows)
        doc
          .fontSize(8)
          .text(JSON.stringify(row, null, 1).replace(/[{}"]/g, ""), {
            lineGap: 1,
          });
    }
    doc.end();
  });
}

const sqlRefusal = (err: unknown, codes: readonly string[]) => {
  const text = err instanceof Error ? err.message : String(err);
  return codes.find((c) => text.includes(c)) ?? null;
};

export async function privacyRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;

  // ---------- Textes en vigueur (public) ----------
  app.get(
    "/v1/legal/current",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { locale: { enum: ["fr", "en"], default: "fr" } },
        },
        response: { 200: anyObject },
      },
    },
    async (request) => {
      const { locale } = request.query as { locale: "fr" | "en" };
      const now = new Date();
      const docs = await asRuntime(db, {}, (tx) =>
        tx.legalDocument.findMany({
          where: { effectiveFrom: { lte: now } },
          orderBy: [{ kind: "asc" }, { version: "desc" }],
        }),
      );
      const documents = kinds.flatMap((kind) => {
        const latest = docs.find((d) => d.kind === kind)?.version;
        const doc =
          docs.find(
            (d) =>
              d.kind === kind && d.version === latest && d.locale === locale,
          ) ?? docs.find((d) => d.kind === kind && d.version === latest);
        return doc
          ? [
              {
                kind,
                version: doc.version,
                locale: doc.locale,
                title: doc.title,
                body: doc.body,
                sha256: doc.sha256,
                effectiveFrom: doc.effectiveFrom.toISOString(),
              },
            ]
          : [];
      });
      return { documents };
    },
  );

  // ---------- Mes données ----------
  app.get(
    "/v1/me/privacy",
    { schema: { response: { 200: anyObject, 401: error } } },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      return asRuntime(db, { userId: principal.userId }, async (tx) => {
        const pending = await tx.$queryRaw<{ kind: Kind; version: number }[]>`
          SELECT kind::text AS kind, version FROM pending_consents(${principal.userId}::uuid)`;
        const [marketing] = await tx.$queryRaw<{ version: number | null }[]>`
          SELECT current_legal_version('MARKETING') AS version`;
        const consents = await tx.consent.findMany({
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        const lastMarketing = consents.find((c) => c.kind === "MARKETING");
        const requests = await tx.dataRequest.findMany({
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        return {
          pending,
          marketing: {
            version: marketing?.version ?? null,
            granted: lastMarketing?.granted ?? false,
          },
          consents: consents.map((c) => ({
            kind: c.kind,
            version: c.version,
            granted: c.granted,
            source: c.source,
            createdAt: c.createdAt.toISOString(),
          })),
          requests: requests.map((r) => ({
            id: r.id,
            kind: r.kind,
            message: r.message,
            status: r.status,
            dueAt: r.dueAt.toISOString(),
            resolution: r.resolution,
            createdAt: r.createdAt.toISOString(),
            closedAt: iso(r.closedAt),
          })),
        };
      });
    },
  );

  app.post(
    "/v1/me/consents",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "version", "granted", "source"],
          properties: {
            kind: { enum: kinds },
            version: { type: "integer", minimum: 1 },
            granted: { type: "boolean" },
            source: { enum: ["signup", "account", "checkout", "update"] },
          },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const body = request.body as {
        kind: Kind;
        version: number;
        granted: boolean;
        source: string;
      };
      const [row] = await asRuntime(
        db,
        { userId: principal.userId },
        (tx) =>
          tx.$queryRaw<{ outcome: string }[]>`
          SELECT record_consent(${body.kind}::"LegalDocumentKind", ${body.version}::integer,
            ${body.granted}, ${body.source}) AS outcome`,
      );
      const outcome = row?.outcome ?? "unknown";
      return outcome === "recorded"
        ? { outcome }
        : reply
            .code(outcome === "unknown_version" ? 404 : 409)
            .send({ error: outcome });
    },
  );

  const exportRoute = async (
    request: Parameters<typeof requirePrincipal>[1],
    reply: FastifyReply,
    format: "json" | "pdf",
  ) => {
    const principal = await requirePrincipal(db, request, reply);
    if (!principal) return reply;
    const { lang } = request.query as { lang: "fr" | "en" };
    const data = await asRuntime(db, { userId: principal.userId }, (tx) =>
      personalData(tx, principal.userId),
    );
    const day = new Date().toISOString().slice(0, 10);
    reply.header("cache-control", "private, no-store");
    if (format === "json")
      return reply
        .header(
          "content-disposition",
          `attachment; filename="duoshop-mes-donnees-${day}.json"`,
        )
        .send(data);
    return reply
      .type("application/pdf")
      .header(
        "content-disposition",
        `attachment; filename="duoshop-mes-donnees-${day}.pdf"`,
      )
      .send(await pdfOf(data, lang));
  };
  const exportSchema = {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: { lang: { enum: ["fr", "en"], default: "fr" } },
      },
    },
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  };
  app.get("/v1/me/export", exportSchema, (request, reply) =>
    exportRoute(request, reply, "json"),
  );
  app.get("/v1/me/export.pdf", exportSchema, (request, reply) =>
    exportRoute(request, reply, "pdf"),
  );

  app.post(
    "/v1/me/data-requests",
    {
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "message"],
          properties: {
            kind: { enum: ["RECTIFICATION", "ERASURE", "OTHER"] },
            message: { type: "string", minLength: 10, maxLength: 2000 },
          },
        },
        response: { 201: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const body = request.body as { kind: string; message: string };
      const [row] = await asRuntime(
        db,
        { userId: principal.userId },
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`
          SELECT open_data_request(${body.kind}::"DataRequestKind", ${body.message}) AS id`,
      );
      return reply.code(201).send({ id: row?.id });
    },
  );

  // ---------- Personnel : demandes ----------
  app.get(
    "/v1/admin/data-requests",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { enum: ["OPEN", "IN_PROGRESS", "DONE", "REJECTED"] },
          },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "privacy:review");
      if (!staff) return reply;
      const { status } = request.query as { status?: string };
      const rows = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.dataRequest.findMany({
            where: status
              ? { status: status as "OPEN" }
              : { status: { in: ["OPEN", "IN_PROGRESS"] } },
            orderBy: { dueAt: "asc" },
            take: 200,
          }),
      );
      return {
        canErase: staff.role === "ADMIN" || staff.role === "COMPLIANCE",
        requests: rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          kind: r.kind,
          message: r.message,
          status: r.status,
          dueAt: r.dueAt.toISOString(),
          overdue: r.dueAt.getTime() < Date.now() && !r.closedAt,
          resolution: r.resolution,
          createdAt: r.createdAt.toISOString(),
          closedAt: iso(r.closedAt),
        })),
      };
    },
  );

  const decisionCodes = {
    ok: 200,
    forbidden: 403,
    not_found: 404,
    already_closed: 409,
    invalid_transition: 409,
    resolution_required: 400,
    use_erasure: 409,
    not_erasure: 409,
    blocked_member: 409,
    blocked_activity: 409,
    anonymized: 200,
  } as Record<string, number>;
  const send = (reply: FastifyReply, outcome: string) => {
    const status = decisionCodes[outcome] ?? 500;
    return status === 200
      ? reply.send({ outcome })
      : reply.code(status).send({ error: outcome });
  };

  app.post(
    "/v1/admin/data-requests/:requestId",
    {
      schema: {
        params: {
          type: "object",
          required: ["requestId"],
          properties: { requestId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: {
            status: { enum: ["IN_PROGRESS", "DONE", "REJECTED"] },
            resolution: { type: "string", maxLength: 2000 },
          },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "privacy:review");
      if (!staff) return reply;
      const { requestId } = request.params as { requestId: string };
      const body = request.body as { status: string; resolution?: string };
      const [row] = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.$queryRaw<{ outcome: string }[]>`
            SELECT update_data_request(${requestId}::uuid, ${body.status}::"DataRequestStatus",
              ${body.resolution ?? null}) AS outcome`,
      );
      return send(reply, row?.outcome ?? "not_found");
    },
  );

  app.post(
    "/v1/admin/data-requests/:requestId/erase",
    {
      schema: {
        params: {
          type: "object",
          required: ["requestId"],
          properties: { requestId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["resolution"],
          properties: { resolution: { type: "string", maxLength: 2000 } },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "privacy:erase");
      if (!staff) return reply;
      const { requestId } = request.params as { requestId: string };
      const { resolution } = request.body as { resolution: string };
      const [row] = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.$queryRaw<{ outcome: string }[]>`
            SELECT execute_erasure(${requestId}::uuid, ${resolution}) AS outcome`,
      );
      return send(reply, row?.outcome ?? "not_found");
    },
  );

  // ---------- Personnel : documents légaux ----------
  app.get(
    "/v1/admin/legal-documents",
    { schema: { response: { 200: anyObject, ...refusals } } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "legal:publish");
      if (!staff) return reply;
      const docs = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.legalDocument.findMany({
            orderBy: [{ kind: "asc" }, { version: "desc" }, { locale: "asc" }],
            take: 200,
          }),
      );
      return {
        documents: docs.map((d) => ({
          id: d.id,
          kind: d.kind,
          version: d.version,
          locale: d.locale,
          title: d.title,
          sha256: d.sha256,
          effectiveFrom: d.effectiveFrom.toISOString(),
          createdAt: d.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/v1/admin/legal-documents",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "kind",
            "version",
            "locale",
            "title",
            "body",
            "effectiveFrom",
          ],
          properties: {
            kind: { enum: kinds },
            version: { type: "integer", minimum: 1 },
            locale: { enum: ["fr", "en"] },
            title: { type: "string", minLength: 3, maxLength: 200 },
            body: { type: "string", minLength: 20, maxLength: 200000 },
            effectiveFrom: { type: "string", format: "date-time" },
          },
        },
        response: { 201: anyObject, ...refusals },
      },
      bodyLimit: 512 * 1024,
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "legal:publish");
      if (!staff) return reply;
      const body = request.body as {
        kind: Kind;
        version: number;
        locale: string;
        title: string;
        body: string;
        effectiveFrom: string;
      };
      try {
        const [row] = await asRuntime(
          db,
          { userId: staff.principal.userId },
          (tx) =>
            tx.$queryRaw<{ id: string }[]>`
              SELECT publish_legal_document(${body.kind}::"LegalDocumentKind",
                ${body.version}::integer, ${body.locale}, ${body.title}, ${body.body},
                ${new Date(body.effectiveFrom)}::timestamptz) AS id`,
        );
        return reply.code(201).send({ id: row?.id });
      } catch (err) {
        const code = sqlRefusal(err, [
          "legal_forbidden",
          "legal_retroactive",
          "legal_version",
          "LegalDocument_kind_version_locale_key",
        ]);
        if (!code) throw err;
        return reply
          .code(
            code === "legal_forbidden"
              ? 403
              : code === "legal_retroactive"
                ? 400
                : 409,
          )
          .send({
            error:
              code === "LegalDocument_kind_version_locale_key"
                ? "legal_version"
                : code,
          });
      }
    },
  );

  // ---------- Personnel : consultations sensibles ----------
  app.post(
    "/v1/admin/stores/:storeId/owner-contact",
    {
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: { reason: { type: "string", maxLength: 500 } },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "contact:reveal");
      if (!staff) return reply;
      const { storeId } = request.params as { storeId: string };
      const { reason } = request.body as { reason: string };
      const [row] = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.$queryRaw<
            {
              owner_name: string | null;
              owner_phone: string | null;
              outcome: string;
            }[]
          >`SELECT * FROM reveal_store_owner(${storeId}::uuid, ${reason})`,
      );
      if (row?.outcome !== "ok")
        return reply
          .code(
            row?.outcome === "reason_required"
              ? 400
              : row?.outcome === "forbidden"
                ? 403
                : 404,
          )
          .send({ error: row?.outcome ?? "not_found" });
      reply.header("cache-control", "private, no-store");
      return { ownerName: row.owner_name, ownerPhone: row.owner_phone };
    },
  );

  app.get(
    "/v1/admin/access-log",
    { schema: { response: { 200: anyObject, ...refusals } } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "access_log:read");
      if (!staff) return reply;
      const rows = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.sensitiveAccessLog.findMany({
            orderBy: { createdAt: "desc" },
            take: 200,
          }),
      );
      return {
        entries: rows.map((r) => ({
          id: r.id,
          actorId: r.actorId,
          resource: r.resource,
          resourceId: r.resourceId,
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );

  app.get(
    "/v1/admin/registry",
    { schema: { response: { 200: anyObject, ...refusals } } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "privacy:review");
      if (!staff) return reply;
      const rows = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) => tx.dataProcessingRegistry.findMany({ orderBy: { key: "asc" } }),
      );
      return { entries: rows };
    },
  );
}
