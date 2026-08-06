import type { FastifyInstance, FastifyRequest } from "fastify";
import { db } from "../db/connection.js";
import { insuranceAttachments, insurancePolicies } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { authGuard } from "../middleware/auth.js";
import { readFileSync } from "fs";
import {
  deleteStoredFile,
  guessMimeType,
  resolveStoredPath,
  saveBuffer,
} from "../health/storage.js";
import {
  INSURANCE_CATEGORIES,
  PREMIUM_FREQUENCIES,
  firstError,
  validateDate,
  validateEnum,
  validateMember,
  validateNonNegative,
  validateRequiredName,
} from "./asset-validation.js";

interface InsuranceBody {
  name: string;
  category: string;
  insuredMemberId?: string | null;
  policyholderMemberId?: string | null;
  policyNumber?: string;
  insurer?: string;
  coverageAmount?: number;
  premium?: number;
  premiumFrequency?: string;
  cashValue?: number;
  startDate?: string;
  endDate?: string;
  claimPhone?: string;
  claimContact?: string;
  claimContactPhone?: string;
  claimChannels?: string;
  claimSteps?: string;
  claimMaterials?: string;
  claimNotes?: string;
  note?: string;
}

async function collectOneFile(request: FastifyRequest) {
  const fields: Record<string, string> = {};
  let file: { buffer: Buffer; filename: string } | undefined;
  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (!file) file = { buffer: await part.toBuffer(), filename: part.filename || "upload" };
      else await part.toBuffer();
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { fields, file };
}

function loadPolicy(id: string) {
  const policy = db.select().from(insurancePolicies).where(eq(insurancePolicies.id, id)).get();
  if (!policy) return null;
  const attachments = db
    .select()
    .from(insuranceAttachments)
    .where(eq(insuranceAttachments.policyId, id))
    .all();
  return { ...policy, attachments };
}

function validateInsuranceBody(
  body: Record<string, unknown>,
  allowArchivedInsuredId?: string | null,
  allowArchivedPolicyholderId?: string | null
): string | null {
  const frequencyError =
    body.premiumFrequency === undefined || body.premiumFrequency === null || body.premiumFrequency === ""
      ? null
      : validateEnum(body.premiumFrequency, PREMIUM_FREQUENCIES, "缴费频率");
  const dateOrderError =
    typeof body.startDate === "string" &&
    typeof body.endDate === "string" &&
    body.startDate &&
    body.endDate &&
    body.endDate < body.startDate
      ? "保险结束日期不能早于开始日期"
      : null;
  return firstError(
    validateRequiredName(body.name, "保单名称"),
    validateEnum(body.category, INSURANCE_CATEGORIES, "保险类别"),
    validateMember(body.insuredMemberId, "被保险成员", allowArchivedInsuredId),
    validateMember(body.policyholderMemberId, "投保成员", allowArchivedPolicyholderId),
    validateNonNegative(body.coverageAmount, "保额"),
    validateNonNegative(body.premium, "保费"),
    validateNonNegative(body.cashValue, "现金价值"),
    frequencyError,
    validateDate(body.startDate, "保险开始日期"),
    validateDate(body.endDate, "保险结束日期"),
    dateOrderError
  );
}

export async function insuranceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get<{ Querystring: { category?: string; insuredMemberId?: string; isActive?: string } }>("/", async (request) => {
    const { category, insuredMemberId, isActive } = request.query;
    const conditions = [];
    if (category) conditions.push(eq(insurancePolicies.category, category));
    if (insuredMemberId) conditions.push(eq(insurancePolicies.insuredMemberId, insuredMemberId));
    if (isActive !== undefined) conditions.push(eq(insurancePolicies.isActive, isActive === "true"));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(insurancePolicies).where(where).all();
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const row = db.select().from(insurancePolicies).where(eq(insurancePolicies.id, request.params.id)).get();
    if (!row) return reply.status(404).send({ error: "Not found" });
    return loadPolicy(row.id);
  });

  app.post<{ Body: InsuranceBody }>("/", async (request, reply) => {
    const body = request.body;
    const normalized = { ...body, name: body.name?.trim() };
    const error = validateInsuranceBody(normalized);
    if (error) return reply.status(400).send({ error });

    const id = nanoid();
    const now = new Date().toISOString();
    db.insert(insurancePolicies)
      .values({
        id,
        name: normalized.name,
        category: body.category,
        insuredMemberId: body.insuredMemberId ?? null,
        policyholderMemberId: body.policyholderMemberId ?? null,
        policyNumber: body.policyNumber ?? null,
        insurer: body.insurer ?? null,
        coverageAmount: body.coverageAmount ?? null,
        premium: body.premium ?? null,
        premiumFrequency: body.premiumFrequency ?? null,
        cashValue: body.cashValue ?? null,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        claimPhone: body.claimPhone ?? null,
        claimContact: body.claimContact ?? null,
        claimContactPhone: body.claimContactPhone ?? null,
        claimChannels: body.claimChannels ?? null,
        claimSteps: body.claimSteps ?? null,
        claimMaterials: body.claimMaterials ?? null,
        claimNotes: body.claimNotes ?? null,
        note: body.note ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return db.select().from(insurancePolicies).where(eq(insurancePolicies.id, id)).get();
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const existing = db.select().from(insurancePolicies).where(eq(insurancePolicies.id, id)).get();
    if (!existing) return reply.status(404).send({ error: "Not found" });

    const merged = {
      ...existing,
      ...request.body,
      name: typeof request.body.name === "string" ? request.body.name.trim() : existing.name,
    };
    const error = validateInsuranceBody(
      merged,
      existing.insuredMemberId,
      existing.policyholderMemberId
    );
    if (error) return reply.status(400).send({ error });

    const allowed = [
      "name",
      "category",
      "insuredMemberId",
      "policyholderMemberId",
      "policyNumber",
      "insurer",
      "coverageAmount",
      "premium",
      "premiumFrequency",
      "cashValue",
      "startDate",
      "endDate",
      "claimPhone",
      "claimContact",
      "claimContactPhone",
      "claimChannels",
      "claimSteps",
      "claimMaterials",
      "claimNotes",
      "note",
      "isActive",
    ];
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const key of allowed) {
      if (request.body[key] !== undefined) updates[key] = request.body[key];
    }

    db.update(insurancePolicies).set(updates).where(eq(insurancePolicies.id, id)).run();
    return db.select().from(insurancePolicies).where(eq(insurancePolicies.id, id)).get();
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const existing = db.select().from(insurancePolicies).where(eq(insurancePolicies.id, id)).get();
    if (!existing) return reply.status(404).send({ error: "Not found" });
    db.update(insurancePolicies)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(insurancePolicies.id, id))
      .run();
    return { success: true, archived: true };
  });

  app.post<{ Params: { id: string } }>("/:id/attachments", async (request, reply) => {
    const policy = db.select().from(insurancePolicies).where(eq(insurancePolicies.id, request.params.id)).get();
    if (!policy) return reply.status(404).send({ error: "保单不存在" });
    const { fields, file } = await collectOneFile(request);
    if (!file) return reply.status(400).send({ error: "未收到附件" });
    if (!/\.(pdf|png|jpe?g|heic)$/i.test(file.filename)) {
      return reply.status(400).send({ error: "仅支持 PDF、JPG、PNG 或 HEIC 文件" });
    }
    const allowedTypes = new Set(["policy", "terms", "payment", "claim_guide", "other"]);
    const type = allowedTypes.has(fields.type) ? fields.type : "other";
    const id = nanoid();
    const filePath = saveBuffer(`insurance/${policy.id}`, file.buffer, file.filename);
    db.insert(insuranceAttachments).values({
      id,
      policyId: policy.id,
      type,
      filePath,
      originalFileName: file.filename,
      caption: fields.caption || null,
      createdAt: new Date().toISOString(),
    }).run();
    return db.select().from(insuranceAttachments).where(eq(insuranceAttachments.id, id)).get();
  });

  app.put<{ Params: { attId: string }; Body: { type?: string; caption?: string | null } }>(
    "/attachments/:attId",
    async (request, reply) => {
      const attachment = db.select().from(insuranceAttachments).where(eq(insuranceAttachments.id, request.params.attId)).get();
      if (!attachment) return reply.status(404).send({ error: "附件不存在" });
      const allowedTypes = new Set(["policy", "terms", "payment", "claim_guide", "other"]);
      db.update(insuranceAttachments).set({
        type: request.body.type && allowedTypes.has(request.body.type) ? request.body.type : attachment.type,
        caption: request.body.caption === undefined ? attachment.caption : request.body.caption,
      }).where(eq(insuranceAttachments.id, attachment.id)).run();
      return db.select().from(insuranceAttachments).where(eq(insuranceAttachments.id, attachment.id)).get();
    }
  );

  app.get<{ Params: { attId: string } }>("/attachments/:attId/file", async (request, reply) => {
    const attachment = db.select().from(insuranceAttachments).where(eq(insuranceAttachments.id, request.params.attId)).get();
    if (!attachment) return reply.status(404).send({ error: "附件不存在" });
    const path = resolveStoredPath(attachment.filePath);
    if (!path) return reply.status(404).send({ error: "附件文件不存在" });
    reply.header("Content-Type", guessMimeType(attachment.originalFileName || path));
    reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.originalFileName || "attachment")}"`);
    return reply.send(readFileSync(path));
  });

  app.delete<{ Params: { attId: string } }>("/attachments/:attId", async (request, reply) => {
    const attachment = db.select().from(insuranceAttachments).where(eq(insuranceAttachments.id, request.params.attId)).get();
    if (!attachment) return reply.status(404).send({ error: "附件不存在" });
    deleteStoredFile(attachment.filePath);
    db.delete(insuranceAttachments).where(eq(insuranceAttachments.id, attachment.id)).run();
    return { success: true };
  });
}
