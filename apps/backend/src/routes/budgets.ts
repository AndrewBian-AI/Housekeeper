import type { FastifyInstance } from "fastify";
import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/connection.js";
import {
  annualBudgetItems,
  annualBudgets,
  annualProjects,
  categories,
  monthlyBudgetItems,
  monthlyBudgets,
} from "../db/schema.js";
import { authGuard } from "../middleware/auth.js";
import {
  getAnnualBudgetExecution,
  getMonthlyBudgetExecution,
  getProjectsForYear,
  normalizeKeywords,
  parseProject,
} from "../budgets/service.js";

interface BudgetItemInput {
  categoryId: string;
  amount: number;
}

const validMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
const validYear = (year: number) => Number.isInteger(year) && year >= 2000 && year <= 2200;
const validAmount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const datesMatchYear = (year: number, start?: string | null, end?: string | null) =>
  (!start || start.startsWith(`${year}-`)) && (!end || end.startsWith(`${year}-`));

function validateItems(items: BudgetItemInput[], total: number): string | null {
  if (!Array.isArray(items)) return "分类预算格式错误";
  const seen = new Set<string>();
  let sum = 0;
  for (const item of items) {
    if (!item.categoryId || seen.has(item.categoryId)) return "分类预算不能重复";
    seen.add(item.categoryId);
    if (!validAmount(item.amount)) return "分类预算金额不能为负数";
    const category = db.select().from(categories).where(eq(categories.id, item.categoryId)).get();
    if (!category || category.type !== "expense") return "预算只能关联支出分类";
    sum += item.amount;
  }
  if (sum > total + 0.001) return "分类预算合计不能超过总预算";
  return null;
}

function preserveArchivedMonthlyItems(
  budgetId: string,
  submittedItems: BudgetItemInput[]
): BudgetItemInput[] {
  const submitted = new Map(submittedItems.map((item) => [item.categoryId, item]));
  const existing = db
    .select()
    .from(monthlyBudgetItems)
    .where(eq(monthlyBudgetItems.budgetId, budgetId))
    .all();
  for (const item of existing) {
    if (submitted.has(item.categoryId)) continue;
    const category = db.select().from(categories).where(eq(categories.id, item.categoryId)).get();
    if (category && !category.isActive) {
      submitted.set(item.categoryId, { categoryId: item.categoryId, amount: item.amount });
    }
  }
  return Array.from(submitted.values());
}

function preserveArchivedAnnualItems(
  budgetId: string,
  submittedItems: BudgetItemInput[]
): BudgetItemInput[] {
  const submitted = new Map(submittedItems.map((item) => [item.categoryId, item]));
  const existing = db
    .select()
    .from(annualBudgetItems)
    .where(eq(annualBudgetItems.budgetId, budgetId))
    .all();
  for (const item of existing) {
    if (submitted.has(item.categoryId)) continue;
    const category = db.select().from(categories).where(eq(categories.id, item.categoryId)).get();
    if (category && !category.isActive) {
      submitted.set(item.categoryId, { categoryId: item.categoryId, amount: item.amount });
    }
  }
  return Array.from(submitted.values());
}

export async function budgetRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get<{ Params: { month: string } }>("/monthly/:month", async (request, reply) => {
    if (!validMonth(request.params.month)) return reply.status(400).send({ error: "月份格式必须是 YYYY-MM" });
    return getMonthlyBudgetExecution(request.params.month);
  });

  app.put<{
    Params: { month: string };
    Body: { totalAmount: number; note?: string | null; items: BudgetItemInput[] };
  }>("/monthly/:month", async (request, reply) => {
    const { month } = request.params;
    const { totalAmount, note } = request.body;
    let { items } = request.body;
    if (!validMonth(month)) return reply.status(400).send({ error: "月份格式必须是 YYYY-MM" });
    if (!validAmount(totalAmount)) return reply.status(400).send({ error: "月度总预算不能为负数" });
    const error = validateItems(items, totalAmount);
    if (error) return reply.status(400).send({ error });
    const now = new Date().toISOString();
    let budget = db.select().from(monthlyBudgets).where(eq(monthlyBudgets.month, month)).get();
    if (!budget) {
      const id = nanoid();
      db.insert(monthlyBudgets).values({ id, month, totalAmount, note: note || null, createdAt: now, updatedAt: now }).run();
      budget = db.select().from(monthlyBudgets).where(eq(monthlyBudgets.id, id)).get()!;
    } else {
      items = preserveArchivedMonthlyItems(budget.id, items);
      const preservedError = validateItems(items, totalAmount);
      if (preservedError) return reply.status(400).send({ error: preservedError });
      db.update(monthlyBudgets).set({ totalAmount, note: note || null, updatedAt: now }).where(eq(monthlyBudgets.id, budget.id)).run();
      db.delete(monthlyBudgetItems).where(eq(monthlyBudgetItems.budgetId, budget.id)).run();
    }
    for (const item of items.filter((item) => item.amount > 0)) {
      db.insert(monthlyBudgetItems).values({
        id: nanoid(),
        budgetId: budget.id,
        categoryId: item.categoryId,
        amount: item.amount,
        createdAt: now,
      }).run();
    }
    return getMonthlyBudgetExecution(month);
  });

  app.post<{ Params: { month: string }; Body: { sourceMonth: string } }>(
    "/monthly/:month/copy",
    async (request, reply) => {
      const { month } = request.params;
      const { sourceMonth } = request.body;
      if (!validMonth(month) || !validMonth(sourceMonth)) return reply.status(400).send({ error: "月份格式错误" });
      const source = db.select().from(monthlyBudgets).where(eq(monthlyBudgets.month, sourceMonth)).get();
      if (!source) return reply.status(404).send({ error: "来源月份尚未设置预算" });
      const sourceItems = db.select().from(monthlyBudgetItems).where(eq(monthlyBudgetItems.budgetId, source.id)).all();
      const now = new Date().toISOString();
      let target = db.select().from(monthlyBudgets).where(eq(monthlyBudgets.month, month)).get();
      if (!target) {
        const id = nanoid();
        db.insert(monthlyBudgets).values({ id, month, totalAmount: source.totalAmount, note: source.note, createdAt: now, updatedAt: now }).run();
        target = db.select().from(monthlyBudgets).where(eq(monthlyBudgets.id, id)).get()!;
      } else {
        db.update(monthlyBudgets).set({ totalAmount: source.totalAmount, note: source.note, updatedAt: now }).where(eq(monthlyBudgets.id, target.id)).run();
        db.delete(monthlyBudgetItems).where(eq(monthlyBudgetItems.budgetId, target.id)).run();
      }
      for (const item of sourceItems) {
        db.insert(monthlyBudgetItems).values({ id: nanoid(), budgetId: target.id, categoryId: item.categoryId, amount: item.amount, createdAt: now }).run();
      }
      return getMonthlyBudgetExecution(month);
    }
  );

  app.get<{ Params: { year: string } }>("/annual/:year", async (request, reply) => {
    const year = Number(request.params.year);
    if (!validYear(year)) return reply.status(400).send({ error: "年份格式错误" });
    return getAnnualBudgetExecution(year);
  });

  app.put<{
    Params: { year: string };
    Body: { expectedIncome: number; regularBudgetAmount: number; note?: string | null; items: BudgetItemInput[] };
  }>("/annual/:year", async (request, reply) => {
    const year = Number(request.params.year);
    const { expectedIncome, regularBudgetAmount, note } = request.body;
    let { items } = request.body;
    if (!validYear(year)) return reply.status(400).send({ error: "年份格式错误" });
    if (!validAmount(expectedIncome) || !validAmount(regularBudgetAmount)) {
      return reply.status(400).send({ error: "年度收入和预算不能为负数" });
    }
    const error = validateItems(items, regularBudgetAmount);
    if (error) return reply.status(400).send({ error });
    const now = new Date().toISOString();
    let budget = db.select().from(annualBudgets).where(eq(annualBudgets.year, year)).get();
    if (!budget) {
      const id = nanoid();
      db.insert(annualBudgets).values({ id, year, expectedIncome, regularBudgetAmount, note: note || null, createdAt: now, updatedAt: now }).run();
      budget = db.select().from(annualBudgets).where(eq(annualBudgets.id, id)).get()!;
    } else {
      items = preserveArchivedAnnualItems(budget.id, items);
      const preservedError = validateItems(items, regularBudgetAmount);
      if (preservedError) return reply.status(400).send({ error: preservedError });
      db.update(annualBudgets).set({ expectedIncome, regularBudgetAmount, note: note || null, updatedAt: now }).where(eq(annualBudgets.id, budget.id)).run();
      db.delete(annualBudgetItems).where(eq(annualBudgetItems.budgetId, budget.id)).run();
    }
    for (const item of items.filter((item) => item.amount > 0)) {
      db.insert(annualBudgetItems).values({ id: nanoid(), budgetId: budget.id, categoryId: item.categoryId, amount: item.amount, createdAt: now }).run();
    }
    return getAnnualBudgetExecution(year);
  });

  app.post<{ Params: { year: string }; Body: { sourceMonth: string } }>(
    "/annual/:year/generate",
    async (request, reply) => {
      const year = Number(request.params.year);
      const source = db.select().from(monthlyBudgets).where(eq(monthlyBudgets.month, request.body.sourceMonth)).get();
      if (!validYear(year) || !validMonth(request.body.sourceMonth)) return reply.status(400).send({ error: "年份或月份格式错误" });
      if (!source) return reply.status(404).send({ error: "来源月份尚未设置预算" });
      if (db.select().from(annualBudgets).where(eq(annualBudgets.year, year)).get()) {
        return reply.status(409).send({ error: "该年份已有年度预算，请直接编辑，避免覆盖现有内容" });
      }
      const sourceItems = db.select().from(monthlyBudgetItems).where(eq(monthlyBudgetItems.budgetId, source.id)).all();
      const now = new Date().toISOString();
      const id = nanoid();
      db.insert(annualBudgets).values({
        id,
        year,
        expectedIncome: 0,
        regularBudgetAmount: source.totalAmount * 12,
        note: `根据 ${request.body.sourceMonth} 月度预算生成`,
        createdAt: now,
        updatedAt: now,
      }).run();
      for (const item of sourceItems) {
        db.insert(annualBudgetItems).values({ id: nanoid(), budgetId: id, categoryId: item.categoryId, amount: item.amount * 12, createdAt: now }).run();
      }
      return getAnnualBudgetExecution(year);
    }
  );

  app.get<{ Querystring: { year?: string; active?: string } }>("/projects", async (request, reply) => {
    const year = Number(request.query.year);
    if (!validYear(year)) return reply.status(400).send({ error: "年份格式错误" });
    return getProjectsForYear(year, request.query.active === "true");
  });

  app.post<{
    Body: { year: number; name: string; budgetAmount: number; startDate?: string | null; endDate?: string | null; keywords?: string[] | string; note?: string | null };
  }>("/projects", async (request, reply) => {
    const body = request.body;
    const name = body.name?.trim();
    if (!validYear(body.year) || !name || !validAmount(body.budgetAmount)) return reply.status(400).send({ error: "请填写正确的年份、专项名称和预算金额" });
    const keywords = normalizeKeywords(body.keywords);
    if (!datesMatchYear(body.year, body.startDate, body.endDate)) {
      return reply.status(400).send({ error: "专项起止日期必须属于所选年份" });
    }
    const projects = getProjectsForYear(body.year, true);
    const usedKeywords = new Set(projects.flatMap((item) => item.keywords));
    const conflict = keywords.find((keyword) => usedKeywords.has(keyword));
    if (conflict) return reply.status(409).send({ error: `关键词“${conflict}”已被同年度其他专项使用` });
    if (body.startDate && body.endDate && body.endDate < body.startDate) return reply.status(400).send({ error: "结束日期不能早于开始日期" });
    const now = new Date().toISOString();
    const id = nanoid();
    try {
      db.insert(annualProjects).values({
        id,
        year: body.year,
        name,
        budgetAmount: body.budgetAmount,
        startDate: body.startDate || null,
        endDate: body.endDate || null,
        keywords: JSON.stringify(keywords),
        note: body.note || null,
        createdAt: now,
        updatedAt: now,
      }).run();
    } catch {
      return reply.status(409).send({ error: "同一年内专项名称不能重复" });
    }
    return getProjectsForYear(body.year).find((item) => item.id === id);
  });

  app.put<{
    Params: { id: string };
    Body: Partial<{ year: number; name: string; budgetAmount: number; startDate: string | null; endDate: string | null; keywords: string[] | string; note: string | null; isActive: boolean }>;
  }>("/projects/:id", async (request, reply) => {
    const existing = db.select().from(annualProjects).where(eq(annualProjects.id, request.params.id)).get();
    if (!existing) return reply.status(404).send({ error: "专项不存在" });
    const merged = { ...existing, ...request.body, name: request.body.name?.trim() || existing.name };
    if (!validYear(merged.year) || !merged.name || !validAmount(merged.budgetAmount)) return reply.status(400).send({ error: "专项数据不正确" });
    const keywords =
      request.body.keywords === undefined
        ? parseProject(existing).keywords
        : normalizeKeywords(request.body.keywords);
    if (!datesMatchYear(merged.year, merged.startDate, merged.endDate)) {
      return reply.status(400).send({ error: "专项起止日期必须属于所选年份" });
    }
    const otherProjects = db.select().from(annualProjects).where(and(eq(annualProjects.year, merged.year), ne(annualProjects.id, existing.id), eq(annualProjects.isActive, true))).all();
    const used = new Set(otherProjects.flatMap((item) => parseProject(item).keywords));
    const conflict = keywords.find((keyword) => used.has(keyword));
    if (conflict) return reply.status(409).send({ error: `关键词“${conflict}”已被同年度其他专项使用` });
    if (merged.startDate && merged.endDate && merged.endDate < merged.startDate) return reply.status(400).send({ error: "结束日期不能早于开始日期" });
    try {
      db.update(annualProjects).set({
        year: merged.year,
        name: merged.name,
        budgetAmount: merged.budgetAmount,
        startDate: merged.startDate || null,
        endDate: merged.endDate || null,
        keywords: JSON.stringify(keywords),
        note: merged.note || null,
        isActive: merged.isActive,
        updatedAt: new Date().toISOString(),
      }).where(eq(annualProjects.id, existing.id)).run();
    } catch {
      return reply.status(409).send({ error: "同一年内专项名称不能重复" });
    }
    return getProjectsForYear(merged.year).find((item) => item.id === existing.id);
  });

  app.delete<{ Params: { id: string } }>("/projects/:id", async (request, reply) => {
    const existing = db.select().from(annualProjects).where(eq(annualProjects.id, request.params.id)).get();
    if (!existing) return reply.status(404).send({ error: "专项不存在" });
    db.update(annualProjects).set({ isActive: false, updatedAt: new Date().toISOString() }).where(eq(annualProjects.id, existing.id)).run();
    return { success: true, archived: true };
  });
}
