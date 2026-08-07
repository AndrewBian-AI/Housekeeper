import type {
  AllocationBucket,
  AllocationStat,
  AllocationOverview,
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
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { assets, financialSnapshots, insurancePolicies, liabilities, members, settings } from "../db/schema.js";
import { authGuard } from "../middleware/auth.js";
import { upsertSetting } from "../db/settings.js";
import { getBusinessToday } from "../utils/date.js";
import { buildFinancialDiagnosis } from "../diagnosis/service.js";

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

  app.get("/allocation", async (): Promise<AllocationOverview> => {
    const allAssetList = getActiveAssets();
    const assetList = allAssetList.filter((asset) => asset.rebalanceMode !== "excluded");
    const insuranceCashValue = getInsuranceCashValue();
    const target = getTargetAllocation();

    const bucketAmount = new Map<AllocationBucket, number>();
    for (const a of assetList) {
      const bucket = (a.allocationBucket as AllocationBucket) || "stable";
      bucketAmount.set(bucket, (bucketAmount.get(bucket) ?? 0) + (a.amount || 0));
    }
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

    return {
      data,
      totalAssets: roundMoney(totalAssets),
      totalBalanceSheetAssets: roundMoney(allAssetList.reduce((sum, asset) => sum + (asset.amount || 0), 0) + insuranceCashValue),
      futureCashFlowOnlyAssets: roundMoney(
        allAssetList
          .filter((asset) => asset.rebalanceMode === "future_cash_flow")
          .reduce((sum, asset) => sum + (asset.amount || 0), 0)
      ),
      excludedAssets: roundMoney(
        allAssetList
          .filter((asset) => asset.rebalanceMode === "excluded")
          .reduce((sum, asset) => sum + (asset.amount || 0), 0)
      ),
      insuranceCashValueExcluded: roundMoney(insuranceCashValue),
    };
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

  // 家庭净资产趋势只使用本功能启用后形成的真实快照，不用当前负债/保险现金价值倒推历史。
  // 单项资产的更早估值记录仍保留在资产明细中查看。
  app.get("/trend", async (): Promise<{ data: NetWorthTrendPoint[] }> => {
    const today = getBusinessToday();
    const data: NetWorthTrendPoint[] = db
      .select()
      .from(financialSnapshots)
      .orderBy(asc(financialSnapshots.snapshotDate))
      .all()
      .map((snapshot) => ({
        date: snapshot.snapshotDate,
        totalAssets: roundMoney(snapshot.totalAssets),
        totalLiabilities: roundMoney(snapshot.totalLiabilities),
        netWorth: roundMoney(snapshot.netWorth),
      }));
    if (!data.some((point) => point.date === today)) {
      const assetTotal = getActiveAssets().reduce((sum, asset) => sum + Number(asset.amount || 0), 0) + getInsuranceCashValue();
      const liabilityTotal = getActiveLiabilities().reduce((sum, liability) => sum + Number(liability.balance || 0), 0);
      data.push({
        date: today,
        totalAssets: roundMoney(assetTotal),
        totalLiabilities: roundMoney(liabilityTotal),
        netWorth: roundMoney(assetTotal - liabilityTotal),
      });
    }

    return { data };
  });

  app.get("/emergency-fund", async (): Promise<EmergencyFundStat> => {
    const liquidity = buildFinancialDiagnosis().liquidity;
    return {
      liquidAssets: liquidity.liquidAssets,
      averageMonthlyExpense: liquidity.plannedMonthlyRequirement,
      targetMonths: liquidity.targetMonths,
      targetAmount: liquidity.targetAmount,
      coverageMonths: liquidity.coverageMonths,
      status: liquidity.status,
      sampleStart: null,
      sampleEnd: null,
      sampleMonths: liquidity.actualSampleMonths,
      dataQuality: liquidity.dataQuality,
      usesPartialMonth: liquidity.usesPartialMonth,
    };
  });
}
