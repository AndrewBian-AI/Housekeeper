import type {
  AllocationBucket,
  AllocationStat,
  AssetPreferences,
  AssetType,
  CompositionItem,
  EmergencyFundStat,
  InvestmentPerformance,
  InvestmentPerformanceItem,
  NetWorthComposition,
  NetWorthOverview,
  NetWorthTrendPoint,
} from "@caiwu/shared";
import {
  ALLOCATION_BUCKET_COLORS,
  ALLOCATION_BUCKET_LABELS,
  ASSET_TYPE_LABELS,
  DEFAULT_EMERGENCY_FUND_MONTHS,
  DEFAULT_TARGET_ALLOCATION,
} from "@caiwu/shared";
import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { assetValuations, assets, insurancePolicies, liabilities, members, settings, transactions } from "../db/schema.js";
import { authGuard } from "../middleware/auth.js";
import { upsertSetting } from "../db/settings.js";
import { getBusinessToday, normalizeDateString } from "../utils/date.js";

const BUCKETS: AllocationBucket[] = ["liquid", "stable", "growth", "protection"];

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 10000) / 100;
}

function getSetting(key: string): string | null {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

function getTargetAllocation(): Record<AllocationBucket, number> {
  const raw = getSetting("asset.target_allocation");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<AllocationBucket, number>>;
      return { ...DEFAULT_TARGET_ALLOCATION, ...parsed };
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_TARGET_ALLOCATION;
}

function getEmergencyMonths(): number {
  const raw = getSetting("asset.emergency_fund_months");
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EMERGENCY_FUND_MONTHS;
}

function getActiveAssets() {
  return db.select().from(assets).where(eq(assets.isActive, true)).all();
}

function getActiveLiabilities() {
  return db.select().from(liabilities).where(eq(liabilities.isActive, true)).all();
}

function getInsuranceCashValue(): number {
  const rows = db
    .select({ total: sql<number>`coalesce(sum(cash_value), 0)` })
    .from(insurancePolicies)
    .where(eq(insurancePolicies.isActive, true))
    .get();
  return Number(rows?.total || 0);
}

function getMemberNameMap(): Map<string, string> {
  return new Map(db.select().from(members).all().map((m) => [m.id, m.name]));
}

function monthStart(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
}

function monthEnd(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
}

function monthsInclusive(start: string, end: string): number {
  const [sy, sm] = start.slice(0, 7).split("-").map(Number);
  const [ey, em] = end.slice(0, 7).split("-").map(Number);
  return (ey - sy) * 12 + em - sm + 1;
}

export async function netWorthRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get("/preferences", async (): Promise<AssetPreferences> => ({
    targetAllocation: getTargetAllocation(),
    emergencyFundMonths: getEmergencyMonths(),
  }));

  app.put<{ Body: AssetPreferences }>("/preferences", async (request, reply) => {
    const target = request.body?.targetAllocation;
    const months = request.body?.emergencyFundMonths;
    const validTarget =
      target &&
      BUCKETS.every((bucket) => Number.isFinite(target[bucket]) && target[bucket] >= 0 && target[bucket] <= 100);
    if (!validTarget) return reply.status(400).send({ error: "资产配置比例必须是0%到100%之间的数字" });
    const total = BUCKETS.reduce((sum, bucket) => sum + target[bucket], 0);
    if (Math.abs(total - 100) > 0.001) return reply.status(400).send({ error: "四类资产配置比例合计必须等于100%" });
    if (!Number.isInteger(months) || months < 1 || months > 24) {
      return reply.status(400).send({ error: "应急资金目标月数必须是1到24之间的整数" });
    }

    upsertSetting("asset.target_allocation", JSON.stringify(target));
    upsertSetting("asset.emergency_fund_months", String(months));
    return { success: true };
  });

  app.get("/overview", async (): Promise<NetWorthOverview> => {
    const assetList = getActiveAssets();
    const liabilityList = getActiveLiabilities();
    const insuranceCashValue = getInsuranceCashValue();

    const assetSum = assetList.reduce((s, a) => s + (a.amount || 0), 0) + insuranceCashValue;
    const liabilitySum = liabilityList.reduce((s, l) => s + (l.balance || 0), 0);

    return {
      totalAssets: roundMoney(assetSum),
      totalLiabilities: roundMoney(liabilitySum),
      netWorth: roundMoney(assetSum - liabilitySum),
      assetCount: assetList.length,
      liabilityCount: liabilityList.length,
      insuranceCashValue: roundMoney(insuranceCashValue),
    };
  });

  app.get("/composition", async (): Promise<NetWorthComposition> => {
    const assetList = getActiveAssets();
    const liabilityList = getActiveLiabilities();
    const insuranceCashValue = getInsuranceCashValue();
    const memberNames = getMemberNameMap();

    const totalAssets = assetList.reduce((s, a) => s + (a.amount || 0), 0) + insuranceCashValue;

    // 按大类
    const typeMap = new Map<string, { amount: number; count: number }>();
    for (const a of assetList) {
      const entry = typeMap.get(a.type) ?? { amount: 0, count: 0 };
      entry.amount += a.amount || 0;
      entry.count += 1;
      typeMap.set(a.type, entry);
    }
    const byType: CompositionItem[] = Array.from(typeMap.entries()).map(([key, v]) => ({
      key,
      label: ASSET_TYPE_LABELS[key as AssetType] ?? key,
      color: null,
      amount: roundMoney(v.amount),
      percentage: totalAssets > 0 ? roundPercent(v.amount / totalAssets) : 0,
      count: v.count,
    }));
    if (insuranceCashValue > 0) {
      byType.push({
        key: "insurance_cash",
        label: "保险现金价值",
        color: null,
        amount: roundMoney(insuranceCashValue),
        percentage: totalAssets > 0 ? roundPercent(insuranceCashValue / totalAssets) : 0,
        count: 0,
      });
    }
    byType.sort((a, b) => b.amount - a.amount);

    // 按配置象限
    const bucketMap = new Map<AllocationBucket, { amount: number; count: number }>();
    for (const a of assetList) {
      const bucket = (a.allocationBucket as AllocationBucket) || "stable";
      const entry = bucketMap.get(bucket) ?? { amount: 0, count: 0 };
      entry.amount += a.amount || 0;
      entry.count += 1;
      bucketMap.set(bucket, entry);
    }
    if (insuranceCashValue > 0) {
      const entry = bucketMap.get("protection") ?? { amount: 0, count: 0 };
      entry.amount += insuranceCashValue;
      bucketMap.set("protection", entry);
    }
    const byBucket: CompositionItem[] = BUCKETS.filter((b) => bucketMap.has(b)).map((b) => {
      const v = bucketMap.get(b)!;
      return {
        key: b,
        label: ALLOCATION_BUCKET_LABELS[b],
        color: ALLOCATION_BUCKET_COLORS[b],
        amount: roundMoney(v.amount),
        percentage: totalAssets > 0 ? roundPercent(v.amount / totalAssets) : 0,
        count: v.count,
      };
    });

    // 按成员（净值口径：资产 + 保险现金价值 - 负债），null 归为家庭共有
    const memberMap = new Map<string | null, number>();
    for (const a of assetList) {
      memberMap.set(a.memberId, (memberMap.get(a.memberId) ?? 0) + (a.amount || 0));
    }
    for (const p of db.select().from(insurancePolicies).where(eq(insurancePolicies.isActive, true)).all()) {
      if (p.cashValue) memberMap.set(p.insuredMemberId, (memberMap.get(p.insuredMemberId) ?? 0) + p.cashValue);
    }
    for (const l of liabilityList) {
      memberMap.set(l.memberId, (memberMap.get(l.memberId) ?? 0) - (l.balance || 0));
    }
    const totalNet = Array.from(memberMap.values()).reduce((s, v) => s + v, 0);
    const byMember: CompositionItem[] = Array.from(memberMap.entries())
      .map(([memberId, amount]) => ({
        key: memberId ?? "shared",
        label: memberId ? memberNames.get(memberId) ?? "未知" : "家庭共有",
        color: null,
        amount: roundMoney(amount),
        percentage: totalNet > 0 ? roundPercent(amount / totalNet) : 0,
        count: 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    return { byType, byBucket, byMember };
  });

  app.get("/allocation", async (): Promise<{ data: AllocationStat[]; totalAssets: number }> => {
    const assetList = getActiveAssets();
    const insuranceCashValue = getInsuranceCashValue();
    const target = getTargetAllocation();

    const bucketAmount = new Map<AllocationBucket, number>();
    for (const a of assetList) {
      const bucket = (a.allocationBucket as AllocationBucket) || "stable";
      bucketAmount.set(bucket, (bucketAmount.get(bucket) ?? 0) + (a.amount || 0));
    }
    bucketAmount.set("protection", (bucketAmount.get("protection") ?? 0) + insuranceCashValue);

    const totalAssets = Array.from(bucketAmount.values()).reduce((s, v) => s + v, 0);

    const data: AllocationStat[] = BUCKETS.map((bucket) => {
      const amount = bucketAmount.get(bucket) ?? 0;
      const currentRatio = totalAssets > 0 ? roundPercent(amount / totalAssets) : 0;
      const targetRatio = target[bucket] ?? 0;
      return {
        bucket,
        label: ALLOCATION_BUCKET_LABELS[bucket],
        color: ALLOCATION_BUCKET_COLORS[bucket],
        amount: roundMoney(amount),
        currentRatio,
        targetRatio,
        gapAmount: roundMoney(amount - (totalAssets * targetRatio) / 100),
      };
    });

    return { data, totalAssets: roundMoney(totalAssets) };
  });

  app.get("/investments", async (): Promise<InvestmentPerformance> => {
    const assetList = getActiveAssets().filter((a) => a.costBasis != null && a.costBasis > 0);

    const items: InvestmentPerformanceItem[] = assetList.map((a) => {
      const costBasis = a.costBasis || 0;
      const currentValue = a.amount || 0;
      const gain = currentValue - costBasis;
      return {
        id: a.id,
        name: a.name,
        type: a.type as AssetType,
        accountInfo: a.accountInfo,
        costBasis: roundMoney(costBasis),
        currentValue: roundMoney(currentValue),
        gain: roundMoney(gain),
        returnRate: costBasis > 0 ? roundPercent(gain / costBasis) : null,
      };
    });

    const totalCost = items.reduce((s, i) => s + i.costBasis, 0);
    const totalValue = items.reduce((s, i) => s + i.currentValue, 0);
    const totalGain = totalValue - totalCost;

    return {
      items: items.sort((a, b) => b.currentValue - a.currentValue),
      totalCost: roundMoney(totalCost),
      totalValue: roundMoney(totalValue),
      totalGain: roundMoney(totalGain),
      totalReturnRate: totalCost > 0 ? roundPercent(totalGain / totalCost) : null,
    };
  });

  // 净资产趋势：从估值快照聚合；负债无历史，按当前总额取平；总会追加「今天」一个点
  app.get("/trend", async (): Promise<{ data: NetWorthTrendPoint[] }> => {
    const assetList = db.select().from(assets).all();
    const liabilityTotal = getActiveLiabilities().reduce((s, l) => s + (l.balance || 0), 0);
    const insuranceCashValue = getInsuranceCashValue();
    const valuations = db.select().from(assetValuations).orderBy(assetValuations.date).all();

    const today = getBusinessToday();
    const dates = Array.from(new Set([...valuations.map((v) => v.date), today])).sort();

    // 每个资产按日期排序的快照
    const byAsset = new Map<string, { date: string; value: number }[]>();
    for (const v of valuations) {
      const arr = byAsset.get(v.assetId) ?? [];
      arr.push({ date: v.date, value: v.value });
      byAsset.set(v.assetId, arr);
    }

    const data: NetWorthTrendPoint[] = dates.map((d) => {
      let totalAssets = insuranceCashValue;
      for (const a of assetList) {
        const snaps = byAsset.get(a.id);
        if (d === today) {
          if (a.isActive) totalAssets += a.amount || 0; // 今天只计入当前有效资产
        } else if (snaps) {
          const applicable = snaps.filter((s) => s.date <= d);
          if (applicable.length > 0) totalAssets += applicable[applicable.length - 1].value;
        }
      }
      return {
        date: d,
        totalAssets: roundMoney(totalAssets),
        totalLiabilities: roundMoney(liabilityTotal),
        netWorth: roundMoney(totalAssets - liabilityTotal),
      };
    });

    return { data };
  });

  app.get("/emergency-fund", async (): Promise<EmergencyFundStat> => {
    const assetList = getActiveAssets();
    const liquidAssets = assetList
      .filter((a) => (a.allocationBucket as AllocationBucket) === "liquid")
      .reduce((s, a) => s + (a.amount || 0), 0);

    const today = normalizeDateString(getBusinessToday())!;
    const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
    const completedEnd = monthEnd(currentYear, currentMonth - 2);
    const windowStart = monthStart(currentYear, currentMonth - 7);

    const completedExpense = db
      .select({
        total: sql<number>`coalesce(sum(amount), 0)`,
        firstDate: sql<string | null>`min(transaction_date)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "expense"),
          gte(transactions.transactionDate, windowStart),
          lte(transactions.transactionDate, completedEnd)
        )
      )
      .get();

    let totalExpense = Number(completedExpense?.total || 0);
    let sampleStart: string | null = completedExpense?.firstDate
      ? `${completedExpense.firstDate.slice(0, 7)}-01`
      : null;
    let sampleEnd: string | null = completedExpense?.firstDate ? completedEnd : null;
    let sampleMonths = sampleStart && sampleEnd ? monthsInclusive(sampleStart, sampleEnd) : 0;
    let usesPartialMonth = false;

    // 尚无完整月份时，临时展示当月数据，但明确标记样本不足。
    if (sampleMonths === 0) {
      const currentStart = monthStart(currentYear, currentMonth - 1);
      const currentExpense = db
        .select({ total: sql<number>`coalesce(sum(amount), 0)` })
        .from(transactions)
        .where(
          and(
            eq(transactions.type, "expense"),
            gte(transactions.transactionDate, currentStart),
            lte(transactions.transactionDate, today)
          )
        )
        .get();
      totalExpense = Number(currentExpense?.total || 0);
      if (totalExpense > 0) {
        sampleStart = currentStart;
        sampleEnd = today;
        sampleMonths = 1;
        usesPartialMonth = currentDay < Number(monthEnd(currentYear, currentMonth - 1).slice(-2));
      }
    }

    const averageMonthlyExpense = sampleMonths > 0 ? roundMoney(totalExpense / sampleMonths) : 0;

    const targetMonths = getEmergencyMonths();
    const targetAmount = roundMoney(averageMonthlyExpense * targetMonths);
    const coverageMonths = averageMonthlyExpense > 0 ? roundMoney(liquidAssets / averageMonthlyExpense) : null;

    let status: EmergencyFundStat["status"] = "unknown";
    const dataQuality: EmergencyFundStat["dataQuality"] =
      !usesPartialMonth && sampleMonths >= 3 ? "sufficient" : "insufficient";
    if (dataQuality === "sufficient" && averageMonthlyExpense > 0 && coverageMonths != null) {
      if (coverageMonths >= targetMonths) status = "sufficient";
      else if (coverageMonths >= targetMonths * 0.5) status = "warning";
      else status = "insufficient";
    }

    return {
      liquidAssets: roundMoney(liquidAssets),
      averageMonthlyExpense,
      targetMonths,
      targetAmount,
      coverageMonths,
      status,
      sampleStart,
      sampleEnd,
      sampleMonths,
      dataQuality,
      usesPartialMonth,
    };
  });
}
