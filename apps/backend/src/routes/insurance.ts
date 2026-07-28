import type { FastifyInstance } from "fastify";
import { db } from "../db/connection.js";
import { insurancePolicies } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { authGuard } from "../middleware/auth.js";
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
  insurer?: string;
  coverageAmount?: number;
  premium?: number;
  premiumFrequency?: string;
  cashValue?: number;
  startDate?: string;
  endDate?: string;
  note?: string;
}

function validateInsuranceBody(body: Record<string, unknown>): string | null {
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
    validateMember(body.insuredMemberId, "被保险成员"),
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
    return row;
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
        insurer: body.insurer ?? null,
        coverageAmount: body.coverageAmount ?? null,
        premium: body.premium ?? null,
        premiumFrequency: body.premiumFrequency ?? null,
        cashValue: body.cashValue ?? null,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
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
    const error = validateInsuranceBody(merged);
    if (error) return reply.status(400).send({ error });

    const allowed = [
      "name",
      "category",
      "insuredMemberId",
      "insurer",
      "coverageAmount",
      "premium",
      "premiumFrequency",
      "cashValue",
      "startDate",
      "endDate",
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
}
