import type {
  AnnualBudgetExecution,
  AnnualProject,
  BudgetCategoryLine,
  BudgetOutsideLine,
  MonthlyBudgetExecution,
} from "@caiwu/shared";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/connection.js";
import {
  annualBudgetItems,
  annualBudgets,
  annualProjects,
  categories,
  monthlyBudgetItems,
  monthlyBudgets,
  transactions,
} from "../db/schema.js";
import { getBusinessToday } from "../utils/date.js";

const money = (value: number) => Math.round(value * 100) / 100;
const percent = (value: number) => Math.round(value * 10000) / 100;

export function normalizeKeywords(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(/[,，\n]/)
      : [];
  return Array.from(new Set(source.map((item) => item.trim()).filter(Boolean)));
}

export function parseProject(row: typeof annualProjects.$inferSelect): AnnualProject {
  let keywords: string[] = [];
  try {
    keywords = normalizeKeywords(JSON.parse(row.keywords || "[]"));
  } catch {
    keywords = normalizeKeywords(row.keywords || "");
  }
  return { ...row, keywords };
}

export function getProjectsForYear(year: number, activeOnly = false): AnnualProject[] {
  const rows = activeOnly
    ? db
        .select()
        .from(annualProjects)
        .where(and(eq(annualProjects.year, year), eq(annualProjects.isActive, true)))
        .all()
    : db.select().from(annualProjects).where(eq(annualProjects.year, year)).all();
  return rows.map(parseProject).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function elapsedMonthRate(month: string): number {
  const today = getBusinessToday();
  const [year, monthNumber] = month.split("-").map(Number);
  const selected = year * 12 + monthNumber;
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  const current = todayYear * 12 + todayMonth;
  if (selected < current) return 100;
  if (selected > current) return 0;
  return percent(todayDay / new Date(year, monthNumber, 0).getDate());
}

function elapsedYearRate(year: number): number {
  const today = getBusinessToday();
  const todayYear = Number(today.slice(0, 4));
  if (year < todayYear) return 100;
  if (year > todayYear) return 0;
  const start = Date.UTC(year, 0, 1);
  const now = Date.UTC(year, Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const days = (Date.UTC(year + 1, 0, 1) - start) / 86400000;
  return percent(((now - start) / 86400000 + 1) / days);
}

function lineStatus(rate: number | null, elapsed: number): BudgetCategoryLine["status"] {
  if (rate !== null && rate >= 100) return "exceeded";
  if (rate !== null && (rate >= 80 || rate > elapsed + 20)) return "warning";
  return "normal";
}

function getExpenseRows(start: string, end: string) {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.type, "expense"),
        gte(transactions.transactionDate, start),
        lte(transactions.transactionDate, end)
      )
    )
    .all();
}

function categoryMaps() {
  const rows = db.select().from(categories).all();
  return {
    byId: new Map(rows.map((row) => [row.id, row])),
    rows,
  };
}

function categoryDisplayName(category: ReturnType<typeof categoryMaps>["rows"][number] | undefined) {
  if (!category) return "已删除分类";
  return `${category.name}${category.isActive ? "" : "（已归档）"}`;
}

export function getMonthlyBudgetExecution(month: string): MonthlyBudgetExecution {
  const budget = db.select().from(monthlyBudgets).where(eq(monthlyBudgets.month, month)).get();
  const items = budget
    ? db.select().from(monthlyBudgetItems).where(eq(monthlyBudgetItems.budgetId, budget.id)).all()
    : [];
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0")}`;
  const expenseRows = getExpenseRows(start, end);
  const { byId } = categoryMaps();
  const elapsedRate = elapsedMonthRate(month);
  const itemMap = new Map(items.map((item) => [item.categoryId, item]));
  const actualByCategory = new Map<string, { amount: number; count: number }>();
  const projectActual = new Map<string, number>();

  for (const row of expenseRows) {
    if (row.annualProjectId) {
      projectActual.set(row.annualProjectId, (projectActual.get(row.annualProjectId) || 0) + row.amount);
      continue;
    }
    const current = actualByCategory.get(row.categoryId) || { amount: 0, count: 0 };
    current.amount += row.amount;
    current.count += 1;
    actualByCategory.set(row.categoryId, current);
  }

  const categoryLines: BudgetCategoryLine[] = items
    .map((item) => {
      const actual = actualByCategory.get(item.categoryId) || { amount: 0, count: 0 };
      const rate = item.amount > 0 ? percent(actual.amount / item.amount) : actual.amount > 0 ? 100 : null;
      return {
        categoryId: item.categoryId,
        categoryName: categoryDisplayName(byId.get(item.categoryId)),
        color: byId.get(item.categoryId)?.color || null,
        budgetAmount: money(item.amount),
        actualAmount: money(actual.amount),
        remainingAmount: money(item.amount - actual.amount),
        executionRate: rate,
        transactionCount: actual.count,
        status: lineStatus(rate, elapsedRate),
      };
    })
    .sort((a, b) => b.actualAmount - a.actualAmount);

  const outsideBudgetLines: BudgetOutsideLine[] = Array.from(actualByCategory.entries())
    .filter(([categoryId]) => !itemMap.has(categoryId))
    .map(([categoryId, actual]) => ({
      categoryId,
      categoryName: categoryDisplayName(byId.get(categoryId)),
      color: byId.get(categoryId)?.color || null,
      actualAmount: money(actual.amount),
      transactionCount: actual.count,
    }))
    .sort((a, b) => b.actualAmount - a.actualAmount);

  const specialProjects = getProjectsForYear(year)
    .map((project) => {
      const actualAmount = money(projectActual.get(project.id) || 0);
      return {
        ...project,
        actualAmount,
        remainingAmount: money(project.budgetAmount - actualAmount),
        executionRate: project.budgetAmount > 0 ? percent(actualAmount / project.budgetAmount) : 0,
      };
    })
    .filter((project) => (project.actualAmount || 0) > 0);

  const totalBudget = money(budget?.totalAmount || 0);
  const allocatedBudget = money(items.reduce((sum, item) => sum + item.amount, 0));
  const budgetedActual = money(categoryLines.reduce((sum, item) => sum + item.actualAmount, 0));
  const outsideBudgetActual = money(outsideBudgetLines.reduce((sum, item) => sum + item.actualAmount, 0));
  const specialProjectActual = money(specialProjects.reduce((sum, item) => sum + (item.actualAmount || 0), 0));
  const dailyActual = money(budgetedActual + outsideBudgetActual);
  const executionRate = totalBudget > 0 ? percent(dailyActual / totalBudget) : null;

  return {
    month,
    budgetId: budget?.id || null,
    totalBudget,
    allocatedBudget,
    unallocatedBudget: money(totalBudget - allocatedBudget),
    budgetedActual,
    outsideBudgetActual,
    specialProjectActual,
    dailyActual,
    allExpense: money(dailyActual + specialProjectActual),
    remainingBudget: money(totalBudget - dailyActual),
    executionRate,
    elapsedRate,
    warningCount:
      categoryLines.filter((item) => item.status !== "normal").length +
      outsideBudgetLines.length +
      (executionRate !== null && lineStatus(executionRate, elapsedRate) !== "normal" ? 1 : 0),
    note: budget?.note || null,
    categoryLines,
    outsideBudgetLines,
    specialProjects,
  };
}

export function getAnnualBudgetExecution(year: number): AnnualBudgetExecution {
  const budget = db.select().from(annualBudgets).where(eq(annualBudgets.year, year)).get();
  const items = budget
    ? db.select().from(annualBudgetItems).where(eq(annualBudgetItems.budgetId, budget.id)).all()
    : [];
  const rows = getExpenseRows(`${year}-01-01`, `${year}-12-31`);
  const incomeRows = db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.type, "income"),
        gte(transactions.transactionDate, `${year}-01-01`),
        lte(transactions.transactionDate, `${year}-12-31`)
      )
    )
    .all();
  const { byId } = categoryMaps();
  const elapsedRate = elapsedYearRate(year);
  const itemMap = new Map(items.map((item) => [item.categoryId, item]));
  const regularActuals = new Map<string, { amount: number; count: number }>();
  const projectActual = new Map<string, number>();
  for (const row of rows) {
    if (row.annualProjectId) {
      projectActual.set(row.annualProjectId, (projectActual.get(row.annualProjectId) || 0) + row.amount);
    } else {
      const current = regularActuals.get(row.categoryId) || { amount: 0, count: 0 };
      current.amount += row.amount;
      current.count += 1;
      regularActuals.set(row.categoryId, current);
    }
  }
  const categoryLines: BudgetCategoryLine[] = items.map((item) => {
    const actual = regularActuals.get(item.categoryId) || { amount: 0, count: 0 };
    const rate = item.amount > 0 ? percent(actual.amount / item.amount) : actual.amount > 0 ? 100 : null;
    return {
      categoryId: item.categoryId,
      categoryName: categoryDisplayName(byId.get(item.categoryId)),
      color: byId.get(item.categoryId)?.color || null,
      budgetAmount: money(item.amount),
      actualAmount: money(actual.amount),
      remainingAmount: money(item.amount - actual.amount),
      executionRate: rate,
      transactionCount: actual.count,
      status: lineStatus(rate, elapsedRate),
    };
  });
  const outsideBudgetLines: BudgetOutsideLine[] = Array.from(regularActuals.entries())
    .filter(([id]) => !itemMap.has(id))
    .map(([categoryId, actual]) => ({
      categoryId,
      categoryName: categoryDisplayName(byId.get(categoryId)),
      color: byId.get(categoryId)?.color || null,
      actualAmount: money(actual.amount),
      transactionCount: actual.count,
    }))
    .sort((a, b) => b.actualAmount - a.actualAmount);
  const specialProjects = getProjectsForYear(year).map((project) => {
    const actualAmount = money(projectActual.get(project.id) || 0);
    return {
      ...project,
      actualAmount,
      remainingAmount: money(project.budgetAmount - actualAmount),
      executionRate: project.budgetAmount > 0 ? percent(actualAmount / project.budgetAmount) : 0,
    };
  });
  const regularBudget = money(budget?.regularBudgetAmount || items.reduce((sum, item) => sum + item.amount, 0));
  const specialBudget = money(
    specialProjects.filter((item) => item.isActive).reduce((sum, item) => sum + item.budgetAmount, 0)
  );
  const regularActual = money(categoryLines.reduce((sum, item) => sum + item.actualAmount, 0));
  const outsideBudgetActual = money(outsideBudgetLines.reduce((sum, item) => sum + item.actualAmount, 0));
  const specialActual = money(specialProjects.reduce((sum, item) => sum + (item.actualAmount || 0), 0));
  const totalBudget = money(regularBudget + specialBudget);
  const expectedIncome = money(budget?.expectedIncome || 0);
  const actualIncome = money(incomeRows.reduce((sum, row) => sum + row.amount, 0));
  const totalActual = money(regularActual + outsideBudgetActual + specialActual);
  const projectedSurplus = money(expectedIncome - totalBudget);
  return {
    year,
    budgetId: budget?.id || null,
    expectedIncome,
    actualIncome,
    regularBudget,
    specialBudget,
    totalBudget,
    regularActual,
    specialActual,
    outsideBudgetActual,
    totalActual,
    projectedSurplus,
    projectedSavingsRate: expectedIncome > 0 ? percent(projectedSurplus / expectedIncome) : null,
    actualSurplus: money(actualIncome - totalActual),
    elapsedRate,
    note: budget?.note || null,
    categoryLines,
    outsideBudgetLines,
    specialProjects,
  };
}
