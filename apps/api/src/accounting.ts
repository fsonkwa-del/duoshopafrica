import { asRuntime, type Database, type ScopedTx } from "@duoshop/database";
import type { CommissionInvoiceDTO, LedgerMappingDTO } from "@duoshop/types";
import type { FastifyInstance, FastifyReply } from "fastify";
import PDFDocument from "pdfkit";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
} from "./guards";
import { requireStaff } from "./staff";
import { inStore } from "./store-scope";

// Lot 4 (ADR 0012) : correspondance SYSCOHADA, factures et avoirs de commission, exports CSV.
// Les factures sont émises par le worker (issue_commission_invoices) ; ici, lecture, PDF,
// paiement constaté par la finance et exports pour l'expert-comptable.
const uuid = { type: "string", format: "uuid" } as const;
const refusals = {
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
} as const;
const anyObject = { type: "object", additionalProperties: true } as const;
const accounts = [
  "PSP_CLEARING",
  "SELLER_PAYABLE",
  "COMMISSION_DEFERRED",
  "COMMISSION_REVENUE",
  "REFUND_PAYABLE",
  "COMMISSION_RECEIVABLE",
  "PSP_FEES",
  "VAT_COLLECTED",
] as const;

type InvoiceRow = Awaited<
  ReturnType<ScopedTx["commissionInvoice"]["findMany"]>
>[number];
export const invoiceNumber = (i: {
  series: string;
  fiscalYear: number;
  number: number;
}) => `${i.series}-${i.fiscalYear}-${String(i.number).padStart(6, "0")}`;
const money = (amount: bigint, currency: string) => ({
  amountMinor: amount.toString(),
  currency,
});
const day = (d: Date) => d.toISOString().slice(0, 10);
function invoiceView(i: InvoiceRow): CommissionInvoiceDTO {
  const seller = (i.seller ?? {}) as { storeName?: string };
  return {
    id: i.id,
    kind: i.kind,
    number: invoiceNumber(i),
    storeId: i.storeId,
    storeName: seller.storeName ?? "",
    periodStart: day(i.periodStart),
    periodEnd: day(i.periodEnd),
    totalTtc: money(i.totalTtcMinor, i.currency),
    vat: money(i.vatMinor, i.currency),
    totalHt: money(i.totalHtMinor, i.currency),
    vatRate: i.vatRate,
    issuedAt: i.issuedAt.toISOString(),
    dueAt: i.dueAt.toISOString(),
    paidAt: i.paidAt?.toISOString() ?? null,
    paidReference: i.paidReference,
  };
}

// PDF bilingue : mentions de la plateforme et du vendeur figées à l'émission, lignes par commande.
function invoicePdf(
  i: InvoiceRow & {
    lines: {
      orderReference: string;
      totalTtcMinor: bigint;
      vatMinor: bigint;
    }[];
  },
): Promise<Buffer> {
  const fmt = (v: bigint) =>
    `${v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${i.currency}`;
  const platform = (i.platform ?? {}) as Record<string, string | null>;
  const seller = (i.seller ?? {}) as Record<string, string | null>;
  const title =
    i.kind === "INVOICE"
      ? "Facture de commission / Commission invoice"
      : "Avoir sur commission / Commission credit note";
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: title },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(16).text(title);
    doc.fontSize(11).text(`N° ${invoiceNumber(i)}`);
    doc
      .fontSize(9)
      .text(
        `Émise le / Issued on ${day(i.issuedAt)} · Période / Period ${day(i.periodStart)} – ${day(i.periodEnd)} · Échéance / Due ${day(i.dueAt)}`,
      );
    doc.moveDown().fontSize(10).text("Émetteur / Issuer", { underline: true });
    doc
      .fontSize(9)
      .text(
        [platform.legalName, platform.address, `NIU ${platform.niu ?? ""}`]
          .filter(Boolean)
          .join("\n"),
      );
    doc.moveDown().fontSize(10).text("Client / Customer", { underline: true });
    doc
      .fontSize(9)
      .text(
        [
          seller.legalName ?? seller.storeName,
          seller.storeName,
          [seller.district, seller.city].filter(Boolean).join(", "),
          seller.registrationNumber
            ? `RCCM ${seller.registrationNumber}`
            : null,
          seller.contactEmail,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    doc.moveDown().fontSize(10).text("Détail / Details", { underline: true });
    for (const l of i.lines)
      doc
        .fontSize(9)
        .text(
          `Commande / Order ${l.orderReference} — TTC ${fmt(l.totalTtcMinor)} dont TVA / incl. VAT ${fmt(l.vatMinor)}`,
        );
    const rate = `${(Number(i.vatRate) * 100).toFixed(2)} %`;
    doc.moveDown().fontSize(10);
    doc.text(`Total HT / Excl. VAT : ${fmt(i.totalHtMinor)}`);
    doc.text(`TVA / VAT (${rate}) : ${fmt(i.vatMinor)}`);
    doc.text(`Total TTC / Incl. VAT : ${fmt(i.totalTtcMinor)}`);
    if (i.paidAt)
      doc.text(
        `Payée le / Paid on ${day(i.paidAt)} (${i.paidReference ?? ""})`,
      );
    doc.end();
  });
}

// CSV compatible Excel en français : BOM UTF-8, séparateur point-virgule, montants entiers.
function csv(rows: (string | number | bigint | null)[][]): string {
  const cell = (v: string | number | bigint | null) => {
    const text = v === null ? "" : String(v);
    return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${rows.map((r) => r.map(cell).join(";")).join("\r\n")}\r\n`;
}

export async function accountingRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;
  const sendPdf = async (
    reply: FastifyReply,
    i: Parameters<typeof invoicePdf>[0],
  ) =>
    reply
      .type("application/pdf")
      .header("cache-control", "private, no-store")
      .header(
        "content-disposition",
        `attachment; filename="${invoiceNumber(i)}.pdf"`,
      )
      .send(await invoicePdf(i));

  // ---------- Correspondance SYSCOHADA ----------
  app.get(
    "/v1/admin/ledger-mapping",
    { schema: { response: { 200: anyObject, ...refusals } } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "finance:review");
      if (!staff) return reply;
      const rows = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.ledgerAccountMapping.findMany({
            orderBy: [{ account: "asc" }, { effectiveFrom: "desc" }],
          }),
      );
      const mappings: LedgerMappingDTO[] = rows.map((m) => ({
        id: m.id,
        account: m.account,
        accountNumber: m.accountNumber,
        label: m.label,
        effectiveFrom: day(m.effectiveFrom),
        validationStatus: m.validationStatus,
      }));
      return { accounts, mappings, canConfigure: staff.role === "FINANCE" };
    },
  );

  app.post(
    "/v1/admin/ledger-mapping",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["account", "accountNumber", "label", "effectiveFrom"],
          properties: {
            account: { enum: accounts },
            accountNumber: { type: "string", pattern: "^[0-9]{2,12}$" },
            label: { type: "string", minLength: 2, maxLength: 160 },
            effectiveFrom: { type: "string", format: "date" },
            validated: { type: "boolean" },
          },
        },
        response: { 201: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "finance:configure");
      if (!staff) return reply;
      const body = request.body as {
        account: (typeof accounts)[number];
        accountNumber: string;
        label: string;
        effectiveFrom: string;
        validated?: boolean;
      };
      const created = await asRuntime(
        db,
        { userId: staff.principal.userId },
        async (tx) => {
          const exists = await tx.ledgerAccountMapping.count({
            where: {
              account: body.account,
              effectiveFrom: new Date(body.effectiveFrom),
            },
          });
          if (exists) return null;
          const m = await tx.ledgerAccountMapping.create({
            data: {
              account: body.account,
              accountNumber: body.accountNumber,
              label: body.label.trim(),
              effectiveFrom: new Date(body.effectiveFrom),
              validationStatus: body.validated ? "VALIDE" : "A_VALIDER",
              createdBy: staff.principal.userId,
            },
          });
          await tx.configAudit.create({
            data: {
              actorId: staff.principal.userId,
              entity: "LedgerAccountMapping",
              entityId: m.id,
              action: "create",
              after: {
                account: m.account,
                accountNumber: m.accountNumber,
                effectiveFrom: body.effectiveFrom,
              },
            },
          });
          return m;
        },
      );
      if (!created) return reply.code(409).send({ error: "already_mapped" });
      return reply.code(201).send({ id: created.id });
    },
  );

  // ---------- Factures (finance, admin) ----------
  app.get(
    "/v1/admin/invoices",
    { schema: { response: { 200: anyObject, ...refusals } } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "finance:review");
      if (!staff) return reply;
      const rows = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.commissionInvoice.findMany({
            orderBy: [{ issuedAt: "desc" }, { number: "desc" }],
            take: 300,
          }),
      );
      return {
        invoices: rows.map(invoiceView),
        canConfigure: staff.role === "FINANCE",
      };
    },
  );

  app.get(
    "/v1/admin/invoices/:invoiceId/pdf",
    {
      schema: {
        params: {
          type: "object",
          required: ["invoiceId"],
          properties: { invoiceId: uuid },
        },
      },
    },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "finance:review");
      if (!staff) return reply;
      const { invoiceId } = request.params as { invoiceId: string };
      const invoice = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.commissionInvoice.findUnique({
            where: { id: invoiceId },
            include: { lines: true },
          }),
      );
      if (!invoice) return reply.code(404).send({ error: "not_found" });
      return sendPdf(reply, invoice);
    },
  );

  app.post(
    "/v1/admin/invoices/:invoiceId/paid",
    {
      schema: {
        params: {
          type: "object",
          required: ["invoiceId"],
          properties: { invoiceId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reference"],
          properties: { reference: { type: "string", maxLength: 200 } },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "finance:configure");
      if (!staff) return reply;
      const { invoiceId } = request.params as { invoiceId: string };
      const { reference } = request.body as { reference: string };
      const [row] = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.$queryRaw<{ outcome: string }[]>`
            SELECT mark_invoice_paid(${invoiceId}::uuid, ${reference}) AS outcome`,
      );
      const outcome = row?.outcome ?? "not_found";
      const status = (
        {
          paid: 200,
          forbidden: 403,
          not_found: 404,
          reference_required: 400,
          already_paid: 409,
          not_invoice: 409,
        } as Record<string, number>
      )[outcome];
      return status === 200
        ? { outcome }
        : reply.code((status ?? 409) as 409).send({ error: outcome });
    },
  );

  // ---------- Factures du vendeur ----------
  app.get(
    "/v1/stores/:storeId/invoices",
    {
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: uuid },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId } = request.params as { storeId: string };
      const result = await inStore(
        db,
        principal,
        storeId,
        "earnings:read",
        (tx) =>
          tx.commissionInvoice.findMany({
            where: { storeId },
            orderBy: [{ issuedAt: "desc" }, { number: "desc" }],
            take: 100,
          }),
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      return { invoices: result.value.map(invoiceView) };
    },
  );

  app.get(
    "/v1/stores/:storeId/invoices/:invoiceId/pdf",
    {
      schema: {
        params: {
          type: "object",
          required: ["storeId", "invoiceId"],
          properties: { storeId: uuid, invoiceId: uuid },
        },
      },
    },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId, invoiceId } = request.params as {
        storeId: string;
        invoiceId: string;
      };
      const result = await inStore(
        db,
        principal,
        storeId,
        "earnings:read",
        (tx) =>
          tx.commissionInvoice.findFirst({
            where: { id: invoiceId, storeId },
            include: { lines: true },
          }),
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      if (!result.value) return reply.code(404).send({ error: "not_found" });
      return sendPdf(reply, result.value);
    },
  );

  // ---------- Exports CSV (finance seule, tracés) ----------
  const period = {
    type: "object",
    additionalProperties: false,
    required: ["from", "to"],
    properties: {
      from: { type: "string", format: "date" },
      to: { type: "string", format: "date" },
    },
  } as const;
  for (const kind of ["ledger", "balance", "vat", "invoices"] as const)
    app.get(
      `/v1/admin/exports/${kind}.csv`,
      {
        config: { rateLimit: { max: 20, timeWindow: 60_000 } },
        schema: { querystring: period },
      },
      async (request, reply) => {
        const staff = await requireStaff(
          db,
          request,
          reply,
          "finance:configure",
        );
        if (!staff) return reply;
        const { from, to } = request.query as { from: string; to: string };
        // Journée de Douala (UTC+1) : bornes incluses.
        const start = new Date(`${from}T00:00:00+01:00`);
        const end = new Date(
          new Date(`${to}T00:00:00+01:00`).getTime() + 86400_000,
        );
        if (end <= start || end.getTime() - start.getTime() > 400 * 86400_000)
          return reply.code(400).send({ error: "invalid_period" });
        const rows = await asRuntime(
          db,
          { userId: staff.principal.userId },
          async (tx) => {
            await tx.configAudit.create({
              data: {
                actorId: staff.principal.userId,
                entity: "Export",
                entityId: staff.principal.userId,
                action: kind,
                after: { from, to },
              },
            });
            const mapping = await tx.ledgerAccountMapping.findMany({
              orderBy: { effectiveFrom: "desc" },
            });
            // Compte SYSCOHADA en vigueur à une date (dernière correspondance antérieure).
            const mapped = (account: string, at: Date) =>
              mapping.find(
                (m) => m.account === account && m.effectiveFrom <= at,
              );
            if (kind === "invoices") {
              const invoices = await tx.commissionInvoice.findMany({
                where: { issuedAt: { gte: start, lt: end } },
                orderBy: [{ series: "asc" }, { number: "asc" }],
              });
              return [
                [
                  "numero",
                  "type",
                  "date",
                  "boutique",
                  "niu_rccm",
                  "ht",
                  "tva",
                  "ttc",
                  "devise",
                  "payee_le",
                  "reference",
                ],
                ...invoices.map((i) => {
                  const seller = i.seller as Record<string, string | null>;
                  return [
                    invoiceNumber(i),
                    i.kind,
                    day(i.issuedAt),
                    seller.storeName ?? "",
                    seller.registrationNumber ?? "",
                    i.totalHtMinor,
                    i.vatMinor,
                    i.totalTtcMinor,
                    i.currency,
                    i.paidAt ? day(i.paidAt) : null,
                    i.paidReference,
                  ];
                }),
              ];
            }
            const entries = await tx.ledgerEntry.findMany({
              where: {
                journal: { occurredAt: { gte: start, lt: end } },
                ...(kind === "vat" ? { account: "VAT_COLLECTED" } : {}),
              },
              include: { journal: true },
              orderBy: [{ journal: { occurredAt: "asc" } }, { id: "asc" }],
            });
            if (kind === "balance") {
              const totals = new Map<
                string,
                { debit: bigint; credit: bigint }
              >();
              for (const e of entries) {
                const t = totals.get(e.account) ?? { debit: 0n, credit: 0n };
                if (e.amountMinor > 0n) t.debit += e.amountMinor;
                else t.credit -= e.amountMinor;
                totals.set(e.account, t);
              }
              return [
                [
                  "compte_interne",
                  "compte_syscohada",
                  "intitule",
                  "debit",
                  "credit",
                  "solde",
                ],
                ...[...totals].map(([account, t]) => {
                  const m = mapped(account, end);
                  return [
                    account,
                    m?.accountNumber ?? "",
                    m?.label ?? "",
                    t.debit,
                    t.credit,
                    t.debit - t.credit,
                  ];
                }),
              ];
            }
            return [
              [
                "date",
                "journal",
                "piece",
                "libelle",
                "compte_interne",
                "compte_syscohada",
                "tiers",
                "debit",
                "credit",
                "devise",
              ],
              ...entries.map((e) => {
                const m = mapped(e.account, e.journal.occurredAt);
                return [
                  day(e.journal.occurredAt),
                  e.journal.kind,
                  e.journal.sourceId,
                  e.journal.description,
                  e.account,
                  m?.accountNumber ?? "",
                  e.tenantId ?? "",
                  e.amountMinor > 0n ? e.amountMinor : null,
                  e.amountMinor < 0n ? -e.amountMinor : null,
                  e.journal.currency,
                ];
              }),
            ];
          },
        );
        return reply
          .type("text/csv; charset=utf-8")
          .header("cache-control", "private, no-store")
          .header(
            "content-disposition",
            `attachment; filename="duoshop-${kind}-${from}-${to}.csv"`,
          )
          .send(csv(rows));
      },
    );
}
