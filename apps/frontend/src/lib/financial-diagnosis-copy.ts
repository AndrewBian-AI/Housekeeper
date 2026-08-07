import type {
  FinancialDiagnosisReport,
  InsuranceCategory,
  MemberIncomeRole,
  MemberRelationship,
} from "@caiwu/shared";
import {
  ALLOCATION_BUCKET_LABELS,
  ASSET_LIQUIDITY_LABELS,
  ASSET_PURPOSE_LABELS,
  ASSET_REBALANCE_MODE_LABELS,
  ASSET_TYPE_LABELS,
  INSURANCE_CATEGORY_LABELS,
} from "@caiwu/shared";

const money = (value: number) => `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value: number | null) => value === null ? "无法计算" : `${value.toFixed(2)}%`;
const cell = (value: unknown) => String(value ?? "-").replaceAll("|", "\\|").replaceAll("\n", " ");

const RELATIONSHIP_LABELS: Record<MemberRelationship, string> = {
  self: "本人",
  spouse: "配偶",
  child: "子女",
  parent: "父母",
  other: "其他",
};

const INCOME_ROLE_LABELS: Record<MemberIncomeRole, string> = {
  primary: "主要收入贡献者",
  secondary: "其他收入贡献者",
  none: "暂无收入",
};

export function formatFinancialDiagnosisSnapshot(report: FinancialDiagnosisReport): string {
  const allocationRows = report.allocation.items.map((item) =>
    `| ${cell(item.label)} | ${money(item.amount)} | ${item.currentRatio.toFixed(2)}% | ${item.targetRatio.toFixed(2)}% | ${item.deviationPoints >= 0 ? "+" : ""}${item.deviationPoints.toFixed(2)}个百分点 |`
  );
  const assetRows = report.allocation.assets.map((asset) =>
    `| ${cell(asset.name)} | ${cell(ASSET_TYPE_LABELS[asset.type])} | ${money(asset.amount)} | ${cell(ALLOCATION_BUCKET_LABELS[asset.allocationBucket])} | ${cell(ASSET_LIQUIDITY_LABELS[asset.liquidity])} | ${cell(ASSET_REBALANCE_MODE_LABELS[asset.rebalanceMode])} | ${cell(ASSET_PURPOSE_LABELS[asset.purpose])} | ${asset.includedInAllocation ? "纳入" : "排除"} |`
  );
  const monthlyBudgetRows = report.monthlyBudget.categoryLines.map((line) =>
    `| ${cell(line.categoryName)} | ${money(line.budgetAmount)} | ${money(line.actualAmount)} | ${money(line.remainingAmount)} | ${percent(line.executionRate)} |`
  );
  const annualBudgetRows = report.annualBudget.categoryLines.map((line) =>
    `| ${cell(line.categoryName)} | ${money(line.budgetAmount)} | ${money(line.actualAmount)} | ${money(line.remainingAmount)} | ${percent(line.executionRate)} |`
  );
  const annualProjectRows = report.annualBudget.specialProjects.map((project) =>
    `| ${cell(project.name)} | ${money(project.budgetAmount)} | ${money(project.actualAmount ?? 0)} | ${money(project.remainingAmount ?? project.budgetAmount)} | ${percent(project.executionRate ?? null)} |`
  );
  const insuranceSections = report.insurance.members.map((member) => {
    const coverages = (Object.entries(member.coverageByCategory) as Array<[InsuranceCategory, number]>)
      .map(([category, amount]) => `${INSURANCE_CATEGORY_LABELS[category]} ${money(amount)}`)
      .join("、") || "未记录保额";
    return `### ${member.memberName}

- 与本人关系：${member.relationship ? RELATIONSHIP_LABELS[member.relationship] : "未维护"}
- 收入角色：${member.incomeRole ? INCOME_ROLE_LABELS[member.incomeRole] : "未维护"}
- 是否经济依赖家庭：${member.isFinancialDependent === null ? "未维护" : member.isFinancialDependent ? "是" : "否"}
- 生效保单：${member.policyCount} 张
- 已记录险种：${member.categories.length ? member.categories.map((category) => INSURANCE_CATEGORY_LABELS[category]).join("、") : "暂无"}
- 已记录保障额度：${coverages}
- 成员资料待补：${member.profileMissing.join("、") || "无"}
- 保单资料待补：${member.policyDataMissing.join("、") || "无"}`;
  });

  return `# 家庭财务现状描述

请基于以下系统确定性计算结果进行家庭财务分析。请先说明数据边界，再提出可执行建议；不要自行补造缺失数据，也不要把计划收入或资产市值变化当成实际收入。

- 数据截至：${report.asOfDate}
- 生成时间：${report.generatedAt}
- 说明：本文不含 API Key、电子保单附件、账户信息或逐笔交易明细，但包含敏感的家庭财务金额。

## 一、必须遵守的计算口径

${report.methodologyNotes.map((note) => `- ${note}`).join("\n")}

## 二、净资产与实际储蓄

- 当前总资产：${money(report.netWorth.totalAssets)}
- 当前总负债：${money(report.netWorth.totalLiabilities)}
- 当前净资产：${money(report.netWorth.netWorth)}
- 净资产基线：${report.netWorth.baselineDate}，${money(report.netWorth.baselineNetWorth)}
- 自基线变化：${report.netWorth.changeAmount === null ? "目前仅有初始基线，不能判断变化趋势" : `${money(report.netWorth.changeAmount)}（${percent(report.netWorth.changeRate)}）`}
- 实际收支期间：${report.savings.periodStart} 至 ${report.savings.periodEnd}
- 实际记账收入：${money(report.savings.actualIncome)}（${report.savings.incomeTransactionCount} 笔）
- 实际记账支出：${money(report.savings.actualExpense)}（${report.savings.expenseTransactionCount} 笔）
- 实际净结余：${money(report.savings.netSavings)}
- 实际储蓄率：${percent(report.savings.savingsRate)}
- 年度预计收入：${money(report.savings.expectedAnnualIncome)}（仅作计划参照）

## 三、预算执行

### 本月预算

- 月份：${report.monthlyBudget.month}
- 日常预算：${report.monthlyBudget.budgetId ? money(report.monthlyBudget.totalBudget) : "未设置"}
- 日常实际支出：${money(report.monthlyBudget.dailyActual)}
- 预算外支出：${money(report.monthlyBudget.outsideBudgetActual)}
- 年度专项本月支出：${money(report.monthlyBudget.specialProjectActual)}（不占用月度日常预算）
- 月度预算执行率：${percent(report.monthlyBudget.executionRate)}

| 支出分类 | 预算 | 实际 | 剩余 | 执行率 |
|---|---:|---:|---:|---:|
${monthlyBudgetRows.length ? monthlyBudgetRows.join("\n") : "| 暂无分类预算 | - | - | - | - |"}

### 年度预算

- 年份：${report.annualBudget.year}
- 年度预计收入：${money(report.annualBudget.expectedIncome)}
- 年度日常预算：${money(report.annualBudget.regularBudget)}
- 年度专项预算：${money(report.annualBudget.specialBudget)}
- 年度总预算：${money(report.annualBudget.totalBudget)}
- 年度预计结余：${money(report.annualBudget.projectedSurplus)}
- 年度预计储蓄率：${percent(report.annualBudget.projectedSavingsRate)}
- 年度实际收入：${money(report.annualBudget.actualIncome)}
- 年度实际支出：${money(report.annualBudget.totalActual)}

| 日常分类 | 年度预算 | 年度实际 | 剩余 | 执行率 |
|---|---:|---:|---:|---:|
${annualBudgetRows.length ? annualBudgetRows.join("\n") : "| 暂无分类预算 | - | - | - | - |"}

| 年度专项 | 预算 | 实际 | 剩余 | 执行率 |
|---|---:|---:|---:|---:|
${annualProjectRows.length ? annualProjectRows.join("\n") : "| 暂无年度专项 | - | - | - | - |"}

## 四、现金安全

- 可随时使用资产：${money(report.liquidity.liquidAssets)}
- 短期可变现资产：${money(report.liquidity.shortTermLiquidAssets)}（未直接计入现金安全月数）
- 日常月度资金需求：${money(report.liquidity.regularMonthlyRequirement)}
- 年度专项月度预留：${money(report.liquidity.specialProjectMonthlyReserve)}
- 合计月度资金需求：${money(report.liquidity.plannedMonthlyRequirement)}
- 当前现金安全月数：${report.liquidity.coverageMonths === null ? "无法计算" : `${report.liquidity.coverageMonths.toFixed(2)} 个月`}
- 目标现金安全月数：${report.liquidity.targetMonths} 个月
- 目标应急资金：${money(report.liquidity.targetAmount)}
- 当前与目标差额：${report.liquidity.gapAmount === null ? "无法计算" : money(report.liquidity.gapAmount)}

## 五、资产结构

- 资产负债表总资产：${money(report.allocation.totalBalanceSheetAssets)}
- 参与目标配置分析：${money(report.allocation.totalAssets)}
- 可直接调整资产：${money(report.allocation.freelyRebalanceableAssets)}
- 仅能调整未来新增资金：${money(report.allocation.futureCashFlowOnlyAssets)}
- 不参与调仓资产：${money(report.allocation.excludedAssets)}
- 排除在配置比例外的保单现金价值：${money(report.allocation.insuranceCashValueExcluded)}

| 配置类别 | 当前金额 | 当前比例 | 系统目标 | 偏离 |
|---|---:|---:|---:|---:|
${allocationRows.join("\n")}

### 逐项资产诊断属性

| 资产 | 大类 | 金额 | 配置类别 | 变现能力 | 调整方式 | 资金用途 | 是否纳入配置比例 |
|---|---|---:|---|---|---|---|---|
${assetRows.join("\n")}

## 六、保险资料

- 生效家庭成员：${report.insurance.activeMemberCount} 人
- 生效保单：${report.insurance.activePolicyCount} 张
- 已关联被保人的保单：${report.insurance.assignedPolicyCount} 张
- 年度经常性保费：${money(report.insurance.recurringAnnualPremium)}
- 预计收入保费负担率：${percent(report.insurance.premiumBurdenRate)}
- 资料状态：${report.insurance.dataStatus === "ready" ? "资料齐备" : report.insurance.dataStatus === "partial" ? "部分待补" : "资料不足"}
- 边界：系统当前只提供保障事实和资料完整度，不输出确定性的保障充足结论。

${insuranceSections.length ? insuranceSections.join("\n\n") : "暂无生效家庭成员资料。"}

## 七、负债与投资记录

- 当前负债：${money(report.debt.totalLiabilities)}
- 资产负债率：${percent(report.debt.debtToAssetRatio)}
- 每月还款：${money(report.debt.monthlyPayment)}
- 预计收入偿债率：${percent(report.debt.annualDebtServiceRate)}
- 可计算投资收益的资产：${report.investment.trackedAssetCount} 项
- 缺少成本的投资资产：${report.investment.missingCostBasisCount} 项
- 已记录投入成本：${money(report.investment.totalCost)}
- 对应当前市值：${money(report.investment.currentValue)}
- 累计浮动收益：${money(report.investment.totalGain)}
- 投资收益率：${percent(report.investment.returnRate)}

## 八、数据提醒

${report.warnings.length ? report.warnings.map((warning) => `- [${warning.level === "warning" ? "警告" : "提示"}] ${warning.message}`).join("\n") : "- 当前没有发现影响计算的数据缺口。"}
`;
}
