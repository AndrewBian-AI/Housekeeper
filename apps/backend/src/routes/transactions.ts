import type { FastifyInstance } from "fastify";
import { db } from "../db/connection.js";
import { transactions, categories, accounts, members, annualProjects } from "../db/schema.js";
import { eq, and, gte, lte, like, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { authGuard } from "../middleware/auth.js";

export async function transactionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get<{
    Querystring: {
      type?: string;
      page?: string;
      limit?: string;
      startDate?: string;
      endDate?: string;
      memberId?: string;
      categoryId?: string;
      minAmount?: string;
      maxAmount?: string;
      keyword?: string;
      annualProjectId?: string;
    };
  }>("/", async (request, reply) => {
    const {
      type,
      page = "1",
      limit = "20",
      startDate,
      endDate,
      memberId,
      categoryId,
      minAmount,
      maxAmount,
      keyword,
      annualProjectId,
    } = request.query;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    if (type) conditions.push(eq(transactions.type, type));
    if (startDate) conditions.push(gte(transactions.transactionDate, startDate));
    if (endDate) conditions.push(lte(transactions.transactionDate, endDate));
    if (memberId) conditions.push(eq(transactions.memberId, memberId));
    if (categoryId) conditions.push(eq(transactions.categoryId, categoryId));
    if (minAmount) conditions.push(gte(transactions.amount, Number(minAmount)));
    if (maxAmount) conditions.push(lte(transactions.amount, Number(maxAmount)));
    if (keyword) conditions.push(like(transactions.description, `%${keyword}%`));
    if (annualProjectId) conditions.push(eq(transactions.annualProjectId, annualProjectId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const data = db
      .select()
      .from(transactions)
      .where(where)
      .orderBy(desc(transactions.transactionDate), desc(transactions.createdAt))
      .limit(limitNum)
      .offset(offset)
      .all();

    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(where)
      .get();

    // Enrich with relations
    const enriched = data.map((t) => {
      const category = db.select().from(categories).where(eq(categories.id, t.categoryId)).get();
      const account = t.accountId ? db.select().from(accounts).where(eq(accounts.id, t.accountId)).get() : null;
      const member = db.select().from(members).where(eq(members.id, t.memberId)).get();
      const annualProject = t.annualProjectId
        ? db.select().from(annualProjects).where(eq(annualProjects.id, t.annualProjectId)).get()
        : null;
      return { ...t, category, account, member, annualProject };
    });

    return {
      data: enriched,
      total: countResult?.count || 0,
      page: pageNum,
      limit: limitNum,
    };
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const t = db.select().from(transactions).where(eq(transactions.id, request.params.id)).get();
    if (!t) return reply.status(404).send({ error: "Not found" });
    const category = db.select().from(categories).where(eq(categories.id, t.categoryId)).get();
    const account = t.accountId ? db.select().from(accounts).where(eq(accounts.id, t.accountId)).get() : null;
    const member = db.select().from(members).where(eq(members.id, t.memberId)).get();
    const annualProject = t.annualProjectId
      ? db.select().from(annualProjects).where(eq(annualProjects.id, t.annualProjectId)).get()
      : null;
    return { ...t, category, account, member, annualProject };
  });

  app.post<{
    Body: {
      type: string;
      amount: number;
      description: string;
      categoryId: string;
      accountId?: string;
      memberId: string;
      transactionDate: string;
      note?: string;
      annualProjectId?: string | null;
    };
  }>("/", async (request, reply) => {
    const body = request.body;
    const member = db.select().from(members).where(eq(members.id, body.memberId)).get();
    if (!member || !member.isActive) {
      return reply.status(400).send({ error: "请选择生效中的家庭成员" });
    }
    const category = db.select().from(categories).where(eq(categories.id, body.categoryId)).get();
    if (!category || !category.isActive || category.type !== body.type) {
      return reply.status(400).send({ error: "请选择当前启用且与收支类型一致的分类" });
    }
    const annualProject = body.annualProjectId
      ? db.select().from(annualProjects).where(eq(annualProjects.id, body.annualProjectId)).get()
      : null;
    if (body.annualProjectId && !annualProject) {
      return reply.status(400).send({ error: "所选年度专项不存在" });
    }
    if (annualProject && (body.type !== "expense" || annualProject.year !== Number(body.transactionDate.slice(0, 4)))) {
      return reply.status(400).send({ error: "年度专项必须与支出年份一致" });
    }
    const id = nanoid();
    const now = new Date().toISOString();
    const annualProjectId =
      body.type === "expense" && body.annualProjectId ? body.annualProjectId : null;
    db.insert(transactions)
      .values({
        id,
        type: body.type,
        amount: body.amount,
        description: body.description,
        categoryId: body.categoryId,
        accountId: body.accountId ?? null,
        memberId: body.memberId,
        transactionDate: body.transactionDate,
        note: body.note ?? null,
        annualProjectId,
        source: "admin",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return db.select().from(transactions).where(eq(transactions.id, id)).get();
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/:id",
    async (request, reply) => {
      const { id } = request.params;
      const existing = db.select().from(transactions).where(eq(transactions.id, id)).get();
      if (!existing) return reply.status(404).send({ error: "Not found" });

      const allowed = ["type", "amount", "description", "categoryId", "accountId", "memberId", "transactionDate", "note", "annualProjectId"];
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      for (const key of allowed) {
        if (request.body[key] !== undefined) updates[key] = request.body[key];
      }
      const mergedType = String(request.body.type ?? existing.type);
      const mergedDate = String(request.body.transactionDate ?? existing.transactionDate);
      const mergedMemberId = String(request.body.memberId ?? existing.memberId);
      const member = db.select().from(members).where(eq(members.id, mergedMemberId)).get();
      if (!member) return reply.status(400).send({ error: "所选成员不存在" });
      if (!member.isActive && mergedMemberId !== existing.memberId) {
        return reply.status(400).send({ error: "已归档成员不能用于新的记账归属" });
      }
      const mergedCategoryId = String(request.body.categoryId ?? existing.categoryId);
      const category = db.select().from(categories).where(eq(categories.id, mergedCategoryId)).get();
      if (!category || category.type !== mergedType) {
        return reply.status(400).send({ error: "分类必须与收支类型一致" });
      }
      if (!category.isActive && mergedCategoryId !== existing.categoryId) {
        return reply.status(400).send({ error: "已归档分类不能用于新的记账归类" });
      }
      const mergedProjectId = request.body.annualProjectId === undefined
        ? existing.annualProjectId
        : (request.body.annualProjectId as string | null);
      if (mergedType !== "expense") {
        updates.annualProjectId = null;
      } else if (mergedProjectId) {
        const project = db.select().from(annualProjects).where(eq(annualProjects.id, mergedProjectId)).get();
        if (!project || project.year !== Number(mergedDate.slice(0, 4))) {
          return reply.status(400).send({ error: "年度专项必须与交易年份一致" });
        }
      }

      db.update(transactions).set(updates).where(eq(transactions.id, id)).run();
      return db.select().from(transactions).where(eq(transactions.id, id)).get();
    }
  );

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const existing = db.select().from(transactions).where(eq(transactions.id, id)).get();
    if (!existing) return reply.status(404).send({ error: "Not found" });
    db.delete(transactions).where(eq(transactions.id, id)).run();
    return { success: true };
  });
}
