import type { FastifyInstance } from "fastify";
import { db } from "../db/connection.js";
import { assets, assetValuations } from "../db/schema.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { authGuard } from "../middleware/auth.js";
import { getBusinessToday } from "../utils/date.js";
import {
  ALLOCATION_BUCKETS,
  ASSET_TYPES,
  firstError,
  validateDate,
  validateEnum,
  validateMember,
  validateNonNegative,
  validateRequiredName,
} from "./asset-validation.js";

interface AssetBody {
  type: string;
  name: string;
  amount: number;
  currency?: string;
  allocationBucket?: string;
  accountInfo?: string;
  costBasis?: number;
  sortOrder?: number;
  memberId?: string | null;
  note?: string;
}

function validateAssetBody(body: Record<string, unknown>, allowArchivedMemberId?: string | null): string | null {
  return firstError(
    validateRequiredName(body.name, "资产名称"),
    validateEnum(body.type, ASSET_TYPES, "资产类型"),
    validateEnum(body.allocationBucket, ALLOCATION_BUCKETS, "配置类别"),
    validateNonNegative(body.amount, "当前价值", true),
    validateNonNegative(body.costBasis, "成本金额"),
    validateMember(body.memberId, "所属成员", allowArchivedMemberId)
  );
}

function upsertValuation(assetId: string, date: string, value: number, note?: string | null) {
  const existing = db
    .select()
    .from(assetValuations)
    .where(and(eq(assetValuations.assetId, assetId), eq(assetValuations.date, date)))
    .get();
  if (existing) {
    db.update(assetValuations)
      .set({ value, note: note === undefined ? existing.note : note })
      .where(eq(assetValuations.id, existing.id))
      .run();
    return existing.id;
  }

  const id = nanoid();
  db.insert(assetValuations)
    .values({
      id,
      assetId,
      date,
      value,
      note: note ?? null,
      createdAt: new Date().toISOString(),
    })
    .run();
  return id;
}

function syncCurrentAmount(assetId: string) {
  const latest = db
    .select()
    .from(assetValuations)
    .where(eq(assetValuations.assetId, assetId))
    .orderBy(desc(assetValuations.date))
    .get();
  db.update(assets)
    .set({ amount: latest?.value ?? 0, updatedAt: new Date().toISOString() })
    .where(eq(assets.id, assetId))
    .run();
}

export async function assetRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get<{ Querystring: { type?: string; bucket?: string; memberId?: string; isActive?: string } }>(
    "/",
    async (request) => {
      const { type, bucket, memberId, isActive } = request.query;
      const conditions = [];
      if (type) conditions.push(eq(assets.type, type));
      if (bucket) conditions.push(eq(assets.allocationBucket, bucket));
      if (memberId) conditions.push(eq(assets.memberId, memberId));
      if (isActive !== undefined) conditions.push(eq(assets.isActive, isActive === "true"));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      return db.select().from(assets).where(where).orderBy(assets.sortOrder, desc(assets.amount)).all();
    }
  );

  // 保留旧形状（type/totalAmount/count），供 AI 月度分析使用，避免破坏现有功能
  app.get("/summary", async () => {
    return db
      .select({
        type: assets.type,
        totalAmount: sql<number>`sum(amount)`,
        count: sql<number>`count(*)`,
      })
      .from(assets)
      .where(eq(assets.isActive, true))
      .groupBy(assets.type)
      .all();
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const asset = db.select().from(assets).where(eq(assets.id, request.params.id)).get();
    if (!asset) return reply.status(404).send({ error: "Not found" });
    return asset;
  });

  app.post<{ Body: AssetBody }>("/", async (request, reply) => {
    const body = request.body;
    const normalized = {
      ...body,
      name: body.name?.trim(),
      allocationBucket: body.allocationBucket ?? "stable",
    };
    const error = validateAssetBody(normalized);
    if (error) return reply.status(400).send({ error });

    const id = nanoid();
    const now = new Date().toISOString();
    db.insert(assets)
      .values({
        id,
        type: normalized.type,
        name: normalized.name,
        amount: body.amount,
        currency: body.currency ?? "CNY",
        allocationBucket: normalized.allocationBucket,
        accountInfo: body.accountInfo ?? null,
        costBasis: body.costBasis ?? null,
        sortOrder: body.sortOrder ?? 0,
        memberId: body.memberId ?? null,
        note: body.note ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    upsertValuation(id, getBusinessToday(), body.amount, "创建资产时的初始估值");
    return db.select().from(assets).where(eq(assets.id, id)).get();
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const existing = db.select().from(assets).where(eq(assets.id, id)).get();
    if (!existing) return reply.status(404).send({ error: "Not found" });

    const merged = {
      ...existing,
      ...request.body,
      name: typeof request.body.name === "string" ? request.body.name.trim() : existing.name,
    };
    const error = validateAssetBody(merged, existing.memberId);
    if (error) return reply.status(400).send({ error });

    const allowed = [
      "type",
      "name",
      "amount",
      "currency",
      "allocationBucket",
      "accountInfo",
      "costBasis",
      "sortOrder",
      "memberId",
      "note",
      "isActive",
    ];
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const key of allowed) {
      if (request.body[key] !== undefined) updates[key] = request.body[key];
    }

    db.update(assets).set(updates).where(eq(assets.id, id)).run();
    if (request.body.amount !== undefined && request.body.amount !== existing.amount) {
      upsertValuation(id, getBusinessToday(), request.body.amount as number, "修改资产当前价值");
      syncCurrentAmount(id);
    }
    return db.select().from(assets).where(eq(assets.id, id)).get();
  });

  // 普通删除改为归档，保留资产及其估值历史。
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const existing = db.select().from(assets).where(eq(assets.id, id)).get();
    if (!existing) return reply.status(404).send({ error: "Not found" });
    db.update(assets).set({ isActive: false, updatedAt: new Date().toISOString() }).where(eq(assets.id, id)).run();
    return { success: true, archived: true };
  });

  // ---- 资产估值快照 ----

  app.get<{ Params: { id: string } }>("/:id/valuations", async (request) => {
    return db
      .select()
      .from(assetValuations)
      .where(eq(assetValuations.assetId, request.params.id))
      .orderBy(desc(assetValuations.date))
      .all();
  });

  // 新增一条估值快照，同时把资产的当前市值同步为该值
  app.post<{ Params: { id: string }; Body: { date: string; value: number; note?: string } }>(
    "/:id/valuations",
    async (request, reply) => {
      const { id } = request.params;
      const asset = db.select().from(assets).where(eq(assets.id, id)).get();
      if (!asset) return reply.status(404).send({ error: "Not found" });

      const dateError =
        validateDate(request.body.date, "估值日期") ??
        (request.body.date > getBusinessToday() ? "估值日期不能晚于今天" : null);
      const error = firstError(dateError, validateNonNegative(request.body.value, "估值金额", true));
      if (error) return reply.status(400).send({ error });

      const vid = upsertValuation(id, request.body.date, request.body.value, request.body.note);
      syncCurrentAmount(id);
      return db.select().from(assetValuations).where(eq(assetValuations.id, vid)).get();
    }
  );

  app.delete<{ Params: { vid: string } }>("/valuations/:vid", async (request, reply) => {
    const { vid } = request.params;
    const existing = db.select().from(assetValuations).where(eq(assetValuations.id, vid)).get();
    if (!existing) return reply.status(404).send({ error: "Not found" });
    db.delete(assetValuations).where(eq(assetValuations.id, vid)).run();
    syncCurrentAmount(existing.assetId);
    return { success: true };
  });
}
