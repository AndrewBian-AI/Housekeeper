import type {
  AllocationBucket,
  AllocationDiagnosis,
  DebtDiagnosis,
  FinancialDiagnosisReport,
  FinancialDiagnosisWarning,
  InsuranceCategory,
  InsuranceDiagnosis,
  InvestmentDiagnosis,
  LiquidityDiagnosis,
  MemberIncomeRole,
  MemberRelationship,
  NetWorthDiagnosis,
  SavingsDiagnosis,
} from "@caiwu/shared";
import {
  ALLOCATION_BUCKET_LABELS,
  DEFAULT_EMERGENCY_FUND_MONTHS,
  DEFAULT_TARGET_ALLOCATION,
} from "@caiwu/shared";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getAnnualBudgetExecution, getMonthlyBudgetExecution } from "../budgets/service.js";
import { db } from "../db/connection.js";
import {
  assets,
  financialSnapshots,
  insurancePolicies,
  liabilities,
  members,
  settings,
  transactions,
} from "../db/schema.js";
import { getBusinessToday } from "../utils/date.js";

const BUCKETS: AllocationBucket[] = ["liquid", "stable", "growth", "protection"];
const DEVIATION_THRESHOLD_POINTS = 5;

const money = (value: number) => Math.round(value * 100) / 100;
const percent = (value: number) => Math.round(value * 10000) / 100;

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

function settingValue(key: string) {
  return db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

function targetAllocation(): Record<AllocationBucket, number> {
  const raw = settingValue("asset.target_allocation");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<AllocationBucket, number>>;
      const merged = { ...DEFAULT_TARGET_ALLOCATION, ...parsed };
      if (BUCKETS.every((bucket) => Number.isFinite(merged[bucket]))) return merged;
    } catch {
      // 使用系统默认值，但由资产配置页继续负责参数维护。
    }
  }
  return DEFAULT_TARGET_ALLOCATION;
}

function emergencyTargetMonths() {
  const value = Number(settingValue("asset.emergency_fund_months"));
  return Number.isInteger(value) && value >= 1 && value <= 24 ? value : DEFAULT_EMERGENCY_FUND_MONTHS;
}

function currentBalanceSheet() {
  const activeAssets = db.select().from(assets).where(eq(assets.isActive, true)).all();
  const activeLiabilities = db.select().from(liabilities).where(eq(liabilities.isActive, true)).all();
  const activePolicies = db.select().from(insurancePolicies).where(eq(insurancePolicies.isActive, true)).all();
  const insuranceCashValue = activePolicies.reduce((sum, policy) => sum + Number(policy.cashValue || 0), 0);
  const totalAssets = activeAssets.reduce((sum, asset) => sum + Number(asset.amount || 0), 0) + insuranceCashValue;
  const totalLiabilities = activeLiabilities.reduce((sum, liability) => sum + Number(liability.balance || 0), 0);
  return {
    activeAssets,
    activeLiabilities,
    activePolicies,
    insuranceCashValue: money(insuranceCashValue),
    totalAssets: money(totalAssets),
    totalLiabilities: money(totalLiabilities),
    netWorth: money(totalAssets - totalLiabilities),
  };
}

export function captureFinancialSnapshot(snapshotDate = getBusinessToday()) {
  const balance = currentBalanceSheet();
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(financialSnapshots)
    .where(eq(financialSnapshots.snapshotDate, snapshotDate))
    .get();
  if (existing) {
    db.update(financialSnapshots)
      .set({
        totalAssets: balance.totalAssets,
        totalLiabilities: balance.totalLiabilities,
        netWorth: balance.netWorth,
        updatedAt: now,
      })
      .where(eq(financialSnapshots.id, existing.id))
      .run();
  } else {
    db.insert(financialSnapshots)
      .values({
        id: nanoid(),
        snapshotDate,
        totalAssets: balance.totalAssets,
        totalLiabilities: balance.totalLiabilities,
        netWorth: balance.netWorth,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  return db
    .select()
    .from(financialSnapshots)
    .where(eq(financialSnapshots.snapshotDate, snapshotDate))
    .get()!;
}

function netWorthDiagnosis(balance: ReturnType<typeof currentBalanceSheet>, today: string): NetWorthDiagnosis {
  const rows = db.select().from(financialSnapshots).orderBy(asc(financialSnapshots.snapshotDate)).all();
  const current = rows.find((row) => row.snapshotDate === today) || { snapshotDate: today, netWorth: balance.netWorth };
  const baseline = rows[0] || current;
  const previousRows = rows.filter((row) => row.snapshotDate < today);
  const previous = previousRows[previousRows.length - 1] || null;
  const hasHistory = baseline.snapshotDate !== current.snapshotDate;
  return {
    totalAssets: balance.totalAssets,
    totalLiabilities: balance.totalLiabilities,
    netWorth: balance.netWorth,
    snapshotDate: current.snapshotDate,
    baselineDate: baseline.snapshotDate,
    baselineNetWorth: money(Number(baseline.netWorth)),
    changeAmount: hasHistory ? money(balance.netWorth - Number(baseline.netWorth)) : null,
    changeRate:
      hasHistory && Number(baseline.netWorth) !== 0
        ? percent((balance.netWorth - Number(baseline.netWorth)) / Math.abs(Number(baseline.netWorth)))
        : null,
    previousDate: previous?.snapshotDate || null,
    previousNetWorth: previous ? money(Number(previous.netWorth)) : null,
    previousChangeAmount: previous ? money(balance.netWorth - Number(previous.netWorth)) : null,
    historyStatus: hasHistory ? "available" : "baseline_only",
  };
}

function savingsDiagnosis(year: number, today: string, expectedAnnualIncome: number): SavingsDiagnosis {
  const periodStart = `${year}-01-01`;
  const rows = db
    .select({
      type: transactions.type,
      total: sql<number>`coalesce(sum(amount), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(and(gte(transactions.transactionDate, periodStart), lte(transactions.transactionDate, today)))
    .groupBy(transactions.type)
    .all();
  const income = rows.find((row) => row.type === "income");
  const expense = rows.find((row) => row.type === "expense");
  const actualIncome = money(Number(income?.total || 0));
  const actualExpense = money(Number(expense?.total || 0));
  const netSavings = money(actualIncome - actualExpense);
  return {
    periodStart,
    periodEnd: today,
    actualIncome,
    actualExpense,
    netSavings,
    savingsRate: actualIncome > 0 ? percent(netSavings / actualIncome) : null,
    incomeTransactionCount: Number(income?.count || 0),
    expenseTransactionCount: Number(expense?.count || 0),
    expectedAnnualIncome: money(expectedAnnualIncome),
    expectedIncomeProgressRate:
      expectedAnnualIncome > 0 ? percent(actualIncome / expectedAnnualIncome) : null,
    basis: "ledger_transactions",
    assetValuationChangesExcluded: true,
  };
}

function allocationDiagnosis(balance: ReturnType<typeof currentBalanceSheet>): AllocationDiagnosis {
  const target = targetAllocation();
  const amountByBucket = new Map<AllocationBucket, number>();
  for (const asset of balance.activeAssets) {
    const bucket = BUCKETS.includes(asset.allocationBucket as AllocationBucket)
      ? (asset.allocationBucket as AllocationBucket)
      : "stable";
    amountByBucket.set(bucket, (amountByBucket.get(bucket) || 0) + Number(asset.amount || 0));
  }
  amountByBucket.set("protection", (amountByBucket.get("protection") || 0) + balance.insuranceCashValue);
  const totalAssets = balance.totalAssets;
  const items = BUCKETS.map((bucket) => {
    const amount = money(amountByBucket.get(bucket) || 0);
    const currentRatio = totalAssets > 0 ? percent(amount / totalAssets) : 0;
    const targetRatio = target[bucket];
    const deviationPoints = money(currentRatio - targetRatio);
    return {
      bucket,
      label: ALLOCATION_BUCKET_LABELS[bucket],
      amount,
      currentRatio,
      targetRatio,
      deviationPoints,
      gapAmount: money(amount - (totalAssets * targetRatio) / 100),
      status:
        Math.abs(deviationPoints) <= DEVIATION_THRESHOLD_POINTS
          ? "on_target" as const
          : deviationPoints > 0
            ? "over" as const
            : "under" as const,
    };
  });
  const maxDeviation = totalAssets > 0
    ? Math.max(...items.map((item) => Math.abs(item.deviationPoints)))
    : null;
  return {
    totalAssets,
    deviationThresholdPoints: DEVIATION_THRESHOLD_POINTS,
    maxAbsoluteDeviationPoints: maxDeviation,
    status:
      totalAssets <= 0
        ? "unknown"
        : maxDeviation !== null && maxDeviation > DEVIATION_THRESHOLD_POINTS
          ? "deviated"
          : "on_target",
    items,
  };
}

function actualRegularExpenseAverage(today: string) {
  const [year, month, day] = today.split("-").map(Number);
  const completedEnd = monthEnd(year, month - 2);
  const windowStart = monthStart(year, month - 7);
  const completed = db
    .select({
      total: sql<number>`coalesce(sum(amount), 0)`,
      firstDate: sql<string | null>`min(transaction_date)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, "expense"),
        isNull(transactions.annualProjectId),
        gte(transactions.transactionDate, windowStart),
        lte(transactions.transactionDate, completedEnd)
      )
    )
    .get();
  let total = Number(completed?.total || 0);
  let sampleMonths = completed?.firstDate
    ? monthsInclusive(`${completed.firstDate.slice(0, 7)}-01`, completedEnd)
    : 0;
  let usesPartialMonth = false;
  if (sampleMonths === 0) {
    const currentStart = `${today.slice(0, 7)}-01`;
    const current = db
      .select({ total: sql<number>`coalesce(sum(amount), 0)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "expense"),
          isNull(transactions.annualProjectId),
          gte(transactions.transactionDate, currentStart),
          lte(transactions.transactionDate, today)
        )
      )
      .get();
    total = Number(current?.total || 0);
    if (total > 0) {
      sampleMonths = 1;
      usesPartialMonth = day < Number(monthEnd(year, month - 1).slice(-2));
    }
  }
  return {
    average: sampleMonths > 0 ? money(total / sampleMonths) : 0,
    sampleMonths,
    usesPartialMonth,
    sufficient: sampleMonths >= 3 && !usesPartialMonth,
  };
}

function liquidityDiagnosis(
  balance: ReturnType<typeof currentBalanceSheet>,
  monthlyBudget: FinancialDiagnosisReport["monthlyBudget"],
  annualBudget: FinancialDiagnosisReport["annualBudget"],
  today: string
): LiquidityDiagnosis {
  const liquidAssets = money(
    balance.activeAssets
      .filter((asset) => asset.allocationBucket === "liquid")
      .reduce((sum, asset) => sum + Number(asset.amount || 0), 0)
  );
  const actual = actualRegularExpenseAverage(today);
  let regularMonthlyRequirement = 0;
  let regularBasis: LiquidityDiagnosis["regularBasis"] = "unavailable";
  let dataQuality: LiquidityDiagnosis["dataQuality"] = "insufficient";
  if (monthlyBudget.budgetId && monthlyBudget.totalBudget > 0) {
    regularMonthlyRequirement = monthlyBudget.totalBudget;
    regularBasis = "monthly_budget";
    dataQuality = "sufficient";
  } else if (annualBudget.budgetId && annualBudget.regularBudget > 0) {
    regularMonthlyRequirement = money(annualBudget.regularBudget / 12);
    regularBasis = "annual_budget";
    dataQuality = "sufficient";
  } else if (actual.average > 0) {
    regularMonthlyRequirement = actual.average;
    regularBasis = "actual_average";
    dataQuality = actual.sufficient ? "sufficient" : "insufficient";
  }

  const currentMonth = Number(today.slice(5, 7));
  const remainingMonths = 13 - currentMonth;
  const remainingSpecialBudget = money(
    annualBudget.specialProjects
      .filter((project) => project.isActive)
      .reduce((sum, project) => sum + Math.max(0, Number(project.remainingAmount ?? project.budgetAmount)), 0)
  );
  const specialProjectMonthlyReserve = money(remainingSpecialBudget / remainingMonths);
  const plannedMonthlyRequirement = money(regularMonthlyRequirement + specialProjectMonthlyReserve);
  const coverageMonths = plannedMonthlyRequirement > 0 ? money(liquidAssets / plannedMonthlyRequirement) : null;
  const targetMonths = emergencyTargetMonths();
  const targetAmount = money(plannedMonthlyRequirement * targetMonths);
  const gapAmount = plannedMonthlyRequirement > 0 ? money(liquidAssets - targetAmount) : null;
  let status: LiquidityDiagnosis["status"] = "unknown";
  if (dataQuality === "sufficient" && coverageMonths !== null) {
    if (coverageMonths >= targetMonths) status = "sufficient";
    else if (coverageMonths >= targetMonths * 0.5) status = "warning";
    else status = "insufficient";
  }
  return {
    liquidAssets,
    regularMonthlyRequirement: money(regularMonthlyRequirement),
    specialProjectMonthlyReserve,
    plannedMonthlyRequirement,
    coverageMonths,
    targetMonths,
    targetAmount,
    gapAmount,
    status,
    regularBasis,
    actualSampleMonths: actual.sampleMonths,
    usesPartialMonth: actual.usesPartialMonth,
    remainingSpecialBudget,
    remainingMonths,
    dataQuality,
  };
}

function annualizedPremium(policy: ReturnType<typeof currentBalanceSheet>["activePolicies"][number]) {
  if (!policy.premium || policy.premium < 0) return 0;
  if (policy.premiumFrequency === "monthly") return policy.premium * 12;
  if (policy.premiumFrequency === "quarterly") return policy.premium * 4;
  if (policy.premiumFrequency === "yearly") return policy.premium;
  return 0;
}

function insuranceDiagnosis(
  balance: ReturnType<typeof currentBalanceSheet>,
  expectedAnnualIncome: number
): InsuranceDiagnosis {
  const activeMembers = db.select().from(members).where(eq(members.isActive, true)).all();
  const policies = balance.activePolicies;
  const memberRows: InsuranceDiagnosis["members"] = activeMembers.map((member) => {
    const memberPolicies = policies.filter((policy) => policy.insuredMemberId === member.id);
    const categories = [...new Set(memberPolicies.map((policy) => policy.category as InsuranceCategory))];
    const coverageByCategory: Partial<Record<InsuranceCategory, number>> = {};
    for (const policy of memberPolicies) {
      const category = policy.category as InsuranceCategory;
      if (policy.coverageAmount !== null) {
        coverageByCategory[category] = money((coverageByCategory[category] || 0) + policy.coverageAmount);
      }
    }
    const profileMissing = [
      !member.relationship && "与本人关系",
      !member.birthDate && "出生日期",
      !member.incomeRole && "家庭收入角色",
      member.isFinancialDependent === null && "经济依赖情况",
    ].filter((value): value is string => Boolean(value));
    const policyDataMissing = memberPolicies.flatMap((policy) => {
      const values: Array<string | false> = [
        !policy.coverageSummary && `${policy.name}：保障责任摘要`,
        !policy.reviewedAt && `${policy.name}：资料核对日期`,
      ];
      if (["life", "accident", "property"].includes(policy.category)) {
        values.push(policy.coverageAmount === null && `${policy.name}：保额`);
      }
      if (policy.category === "medical") {
        values.push(
          policy.coverageAmount === null && policy.annualLimit === null && `${policy.name}：保额或年度赔付限额`,
          policy.deductible === null && `${policy.name}：免赔额`,
          policy.reimbursementRatio === null && `${policy.name}：赔付比例`,
          !policy.renewalType && `${policy.name}：续保条件`
        );
      }
      return values.filter((value): value is string => Boolean(value));
    });
    return {
      memberId: member.id,
      memberName: member.name,
      relationship: member.relationship as MemberRelationship | null,
      incomeRole: member.incomeRole as MemberIncomeRole | null,
      isFinancialDependent: member.isFinancialDependent,
      policyCount: memberPolicies.length,
      categories,
      coverageByCategory,
      profileMissing,
      policyDataMissing,
    };
  });
  const recurringAnnualPremium = money(policies.reduce((sum, policy) => sum + annualizedPremium(policy), 0));
  const unannualizedPremiumPolicyCount = policies.filter(
    (policy) => Number(policy.premium || 0) > 0 && !policy.premiumFrequency
  ).length;
  const assignedPolicyCount = policies.filter((policy) => policy.insuredMemberId).length;
  const allReady =
    policies.length > 0 &&
    activeMembers.length > 0 &&
    assignedPolicyCount === policies.length &&
    memberRows.every(
      (member) => member.policyCount > 0 && member.profileMissing.length === 0 && member.policyDataMissing.length === 0
    );
  return {
    activeMemberCount: activeMembers.length,
    activePolicyCount: policies.length,
    assignedPolicyCount,
    membersWithPolicyCount: memberRows.filter((member) => member.policyCount > 0).length,
    recurringAnnualPremium,
    premiumBurdenRate: expectedAnnualIncome > 0 ? percent(recurringAnnualPremium / expectedAnnualIncome) : null,
    premiumIncomeBasis: expectedAnnualIncome > 0 ? "annual_budget_expected" : "unavailable",
    unannualizedPremiumPolicyCount,
    dataStatus:
      policies.length === 0 || activeMembers.length === 0 ? "missing" : allReady ? "ready" : "partial",
    adequacyConclusionAvailable: false,
    members: memberRows,
  };
}

function debtDiagnosis(
  balance: ReturnType<typeof currentBalanceSheet>,
  expectedAnnualIncome: number
): DebtDiagnosis {
  const monthlyPayment = money(
    balance.activeLiabilities.reduce((sum, liability) => sum + Number(liability.monthlyPayment || 0), 0)
  );
  return {
    totalLiabilities: balance.totalLiabilities,
    totalAssets: balance.totalAssets,
    debtToAssetRatio: balance.totalAssets > 0 ? percent(balance.totalLiabilities / balance.totalAssets) : null,
    monthlyPayment,
    annualDebtServiceRate:
      expectedAnnualIncome > 0 ? percent((monthlyPayment * 12) / expectedAnnualIncome) : null,
    incomeBasis: expectedAnnualIncome > 0 ? "annual_budget_expected" : "unavailable",
  };
}

function investmentDiagnosis(balance: ReturnType<typeof currentBalanceSheet>): InvestmentDiagnosis {
  const growthAssets = balance.activeAssets.filter((asset) => asset.allocationBucket === "growth");
  const tracked = growthAssets.filter((asset) => asset.costBasis !== null && asset.costBasis > 0);
  const totalCost = money(tracked.reduce((sum, asset) => sum + Number(asset.costBasis || 0), 0));
  const currentValue = money(tracked.reduce((sum, asset) => sum + Number(asset.amount || 0), 0));
  const totalGain = money(currentValue - totalCost);
  return {
    trackedAssetCount: tracked.length,
    missingCostBasisCount: growthAssets.length - tracked.length,
    totalCost,
    currentValue,
    totalGain,
    returnRate: totalCost > 0 ? percent(totalGain / totalCost) : null,
  };
}

export function buildFinancialDiagnosis(): FinancialDiagnosisReport {
  const today = getBusinessToday();
  const year = Number(today.slice(0, 4));
  const month = today.slice(0, 7);
  const balance = currentBalanceSheet();
  const monthlyBudget = getMonthlyBudgetExecution(month);
  const annualBudget = getAnnualBudgetExecution(year);
  const netWorth = netWorthDiagnosis(balance, today);
  const savings = savingsDiagnosis(year, today, annualBudget.expectedIncome);
  const allocation = allocationDiagnosis(balance);
  const liquidity = liquidityDiagnosis(balance, monthlyBudget, annualBudget, today);
  const insurance = insuranceDiagnosis(balance, annualBudget.expectedIncome);
  const debt = debtDiagnosis(balance, annualBudget.expectedIncome);
  const investment = investmentDiagnosis(balance);
  const warnings: FinancialDiagnosisWarning[] = [];

  if (netWorth.historyStatus === "baseline_only") {
    warnings.push({ code: "NET_WORTH_BASELINE_ONLY", level: "info", message: "目前只有初始净资产快照，系统不会倒推历史变化；产生第二个不同日期的快照后才计算净资产变化。" });
  }
  if (savings.actualIncome <= 0) {
    warnings.push({ code: "NO_LEDGER_INCOME", level: "warning", message: "本年度尚无记账收入，储蓄率无法计算；资产市值更新不会被当作收入。" });
  }
  if (!monthlyBudget.budgetId) {
    warnings.push({ code: "NO_MONTHLY_BUDGET", level: "info", message: "本月尚未维护月度预算，现金安全月数将改用年度预算或历史日常支出。" });
  }
  if (!annualBudget.budgetId) {
    warnings.push({ code: "NO_ANNUAL_BUDGET", level: "info", message: "本年度尚未维护年度预计收入和日常预算，部分收入负担指标无法计算。" });
  }
  if (liquidity.dataQuality === "insufficient") {
    warnings.push({ code: "LIQUIDITY_BASIS_INSUFFICIENT", level: "warning", message: "现金安全月数的日常支出依据不足，当前数值仅供参考，不给出充足或不足结论。" });
  }
  if (insurance.dataStatus !== "ready") {
    warnings.push({ code: "INSURANCE_DATA_PARTIAL", level: "info", message: "家庭成员或保单资料尚未完全齐备，本批只展示已记录保障事实，不判断保障是否充足。" });
  }
  if (insurance.assignedPolicyCount < insurance.activePolicyCount) {
    warnings.push({ code: "UNASSIGNED_POLICIES", level: "warning", message: `有 ${insurance.activePolicyCount - insurance.assignedPolicyCount} 张生效保单尚未关联被保人。` });
  }
  if (insurance.unannualizedPremiumPolicyCount > 0) {
    warnings.push({ code: "PREMIUM_FREQUENCY_MISSING", level: "info", message: `有 ${insurance.unannualizedPremiumPolicyCount} 张保单已填写保费但未填写缴费频率，年度经常性保费和保费负担率可能偏低。` });
  }
  if (investment.missingCostBasisCount > 0) {
    warnings.push({ code: "MISSING_COST_BASIS", level: "info", message: `有 ${investment.missingCostBasisCount} 项进攻类资产未填写投入成本，无法计算完整投资收益。` });
  }

  return {
    generatedAt: new Date().toISOString(),
    asOfDate: today,
    year,
    month,
    netWorth,
    savings,
    allocation,
    liquidity,
    insurance,
    debt,
    investment,
    monthlyBudget,
    annualBudget,
    warnings,
    methodologyNotes: [
      "储蓄率只使用记账管理中的实际收入与实际支出；资产市值、公积金余额更新和年度预计收入均不计作已实现收入。",
      "年度预计收入只用于年度预算测算、保费负担和偿债负担的参考分母，不替代实际收入。",
      "净资产变化从本功能启用后记录的真实快照开始计算，不根据当前余额倒推历史。",
      "现金安全月数优先使用当前月度预算，其次使用年度日常预算，最后使用历史日常支出；年度专项按剩余预算在年内剩余月份分摊。",
      "保险部分只检查成员覆盖事实和资料完整度；资料缺失不会被解释为没有保障或保障不足。",
    ],
  };
}
