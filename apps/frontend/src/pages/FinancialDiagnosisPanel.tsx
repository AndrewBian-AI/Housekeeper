import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/api/client";
import type {
  FinancialDiagnosisReport,
  InsuranceCategory,
  LiquidityDiagnosis,
} from "@caiwu/shared";
import { INSURANCE_CATEGORY_LABELS } from "@caiwu/shared";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  HelpCircle,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

const currency = (value: number) => `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedCurrency = (value: number) => `${value >= 0 ? "+" : "-"}${currency(Math.abs(value))}`;
const rate = (value: number | null) => value === null ? "无法计算" : `${value.toFixed(2)}%`;

const LIQUIDITY_STATUS: Record<LiquidityDiagnosis["status"], string> = {
  sufficient: "达到目标",
  warning: "接近下限",
  insufficient: "低于目标",
  unknown: "依据不足",
};

const REGULAR_BASIS: Record<LiquidityDiagnosis["regularBasis"], string> = {
  monthly_budget: "本月日常预算",
  annual_budget: "年度日常预算月均值",
  actual_average: "历史日常支出月均值",
  unavailable: "暂无可靠日常支出依据",
};

const HELP = {
  netWorth: "当前净资产＝所有生效资产余额＋生效保单现金价值－所有生效负债余额。资产市值更新会影响本指标。",
  netWorthChange: "从首次启用本功能时建立的真实快照开始比较。当天重复进入只更新当天快照，不会倒推启用前的历史变化。",
  savingsRate: "本年实际储蓄率＝（记账收入－记账支出）÷记账收入。只使用记账管理中的实际流水，不把资产市值、公积金余额更新或年度预计收入当作实际收入。",
  liquidity: "现金安全月数＝现金及活钱÷月度资金需求。月度资金需求包含日常需求和年度专项剩余预算的月度预留。日常需求依次取本月预算、年度日常预算月均值或历史日常支出月均值。",
  allocationDeviation: "分别计算现金及活钱、稳健保值、长期增值和保障资产的当前比例与目标比例之差，再展示绝对值最大的偏离。目标比例来自资产管理中的参数设置。",
  insuranceStatus: "检查生效家庭成员是否关联保单，以及成员资料、保障摘要、保额、免赔额、续保条件等关键资料是否齐备。这里只判断资料完整度，不判断保障是否充足。",
  debtRatio: "资产负债率＝当前生效负债余额÷当前总资产。没有负债时显示为 0%，不会推断已经偿还的历史负债。",
  investmentReturn: "投资收益率＝（当前市值－投入成本）÷投入成本。只统计归入长期增值、且已维护投入成本的资产；缺少成本的数据不会被猜测。",
  allocationPanel: "按每项资产维护的配置类别汇总。当前比例＝该类资产金额÷总资产；偏离＝当前比例－目标比例。保险现金价值计入保障资产。",
  liquidityPanel: "展示现金安全月数的每个组成部分。年度专项只按尚未使用的预算，在本年度剩余月份中平均预留，避免遗漏旅游等非每月发生的大额计划。",
  savingsPanel: "展示本年度截至今天的实际记账收支。年度预计收入仅用于计划进度、保费负担和偿债负担参考，不参与实际储蓄率。",
  insurancePanel: "按生效家庭成员展示已关联险种、已记录保额和待补资料。资料缺失只会形成提醒，不会被解释为没有保障或保障不足。",
  budgetPanel: "同时展示月度日常预算、预算外支出和年度专项执行。年度专项支出不占用月度日常预算，也不计入月度预算外支出。",
  investmentDebtPanel: "投资部分使用已维护的投入成本和当前市值；负债部分使用生效负债余额和月供。预计收入仅作为偿债负担率的计划参考分母。",
  warningsPanel: "集中列出会影响指标完整性或可靠性的资料缺口。缺少数据时系统降低结论强度，而不是阻止分析或自动补造数据。",
} as const;

export function FinancialDiagnosisPanel() {
  const [report, setReport] = useState<FinancialDiagnosisReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      // 同一天重复进入只更新当天快照，不会制造多条历史记录。
      await api.post("/financial-diagnosis/snapshots/capture", {});
      setReport(await api.get<FinancialDiagnosisReport>("/financial-diagnosis"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "财务诊断数据加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (loading && !report) {
    return <div className="flex items-center justify-center gap-2 rounded-lg border bg-card p-10 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" />正在计算家庭财务指标</div>;
  }

  if (error && !report) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  if (!report) return null;

  const netWorthChange = report.netWorth.changeAmount;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold">资产配置诊断数据</h2>
        <p className="mt-1 text-sm text-muted-foreground">截至 {report.asOfDate} · 确定性计算结果，尚未调用大模型生成建议</p>
      </div>
      <button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />重新计算</button>
    </div>

    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="当前净资产" help={HELP.netWorth} value={currency(report.netWorth.netWorth)} note={`资产 ${currency(report.netWorth.totalAssets)} · 负债 ${currency(report.netWorth.totalLiabilities)}`} />
      <Metric
        label="净资产变化"
        help={HELP.netWorthChange}
        value={netWorthChange === null ? "已建立初始基线" : signedCurrency(netWorthChange)}
        note={netWorthChange === null ? `基线日期 ${report.netWorth.baselineDate}` : `自 ${report.netWorth.baselineDate} · ${rate(report.netWorth.changeRate)}`}
        tone={netWorthChange === null ? "default" : netWorthChange >= 0 ? "success" : "danger"}
      />
      <Metric label="本年实际储蓄率" help={HELP.savingsRate} value={rate(report.savings.savingsRate)} note={`记账收入 ${currency(report.savings.actualIncome)} · 结余 ${signedCurrency(report.savings.netSavings)}`} tone={report.savings.savingsRate === null ? "default" : report.savings.savingsRate >= 0 ? "success" : "danger"} />
      <Metric label="现金安全月数" help={HELP.liquidity} value={report.liquidity.coverageMonths === null ? "无法计算" : `${report.liquidity.coverageMonths.toFixed(2)} 个月`} note={`${LIQUIDITY_STATUS[report.liquidity.status]} · 目标 ${report.liquidity.targetMonths} 个月`} tone={report.liquidity.status === "sufficient" ? "success" : report.liquidity.status === "insufficient" ? "danger" : "default"} />
      <Metric label="资产配置最大偏离" help={HELP.allocationDeviation} value={report.allocation.maxAbsoluteDeviationPoints === null ? "无法计算" : `${report.allocation.maxAbsoluteDeviationPoints.toFixed(2)} 个百分点`} note={`提醒阈值 ${report.allocation.deviationThresholdPoints} 个百分点`} tone={report.allocation.status === "deviated" ? "danger" : report.allocation.status === "on_target" ? "success" : "default"} />
      <Metric label="保险资料状态" help={HELP.insuranceStatus} value={report.insurance.dataStatus === "ready" ? "资料齐备" : report.insurance.dataStatus === "partial" ? "部分待补" : "资料不足"} note={`${report.insurance.membersWithPolicyCount}/${report.insurance.activeMemberCount} 名成员已关联保单`} tone={report.insurance.dataStatus === "ready" ? "success" : "default"} />
      <Metric label="资产负债率" help={HELP.debtRatio} value={rate(report.debt.debtToAssetRatio)} note={`月供 ${currency(report.debt.monthlyPayment)}`} />
      <Metric label="投资收益记录" help={HELP.investmentReturn} value={rate(report.investment.returnRate)} note={`${report.investment.trackedAssetCount} 项可计算 · ${report.investment.missingCostBasisCount} 项缺成本`} />
    </div>

    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      <div className="flex items-start gap-2"><Database className="mt-0.5 h-4 w-4 flex-none" /><div><p className="font-medium">本页只展示事实和计算口径</p><p className="mt-1 text-xs text-blue-800">年度预计收入不会计入实际储蓄；资产、公积金和投资市值更新只影响净资产。第四批才会把这些数据交给大模型生成解释和建议。</p></div></div>
    </div>

    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="资产结构与目标比例" help={HELP.allocationPanel} icon={<WalletCards className="h-5 w-5" />}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">配置类别</th><th className="py-2 text-right">当前金额</th><th className="py-2 text-right">当前</th><th className="py-2 text-right">目标</th><th className="py-2 text-right">偏离</th><th className="py-2 text-right">状态</th></tr></thead>
            <tbody>{report.allocation.items.map((item) => <tr key={item.bucket} className="border-b last:border-0"><td className="py-2 font-medium">{item.label}</td><td className="py-2 text-right">{currency(item.amount)}</td><td className="py-2 text-right">{item.currentRatio}%</td><td className="py-2 text-right">{item.targetRatio}%</td><td className={`py-2 text-right ${Math.abs(item.deviationPoints) > report.allocation.deviationThresholdPoints ? "text-red-600" : ""}`}>{item.deviationPoints >= 0 ? "+" : ""}{item.deviationPoints}%</td><td className="py-2 text-right">{item.status === "over" ? "超配" : item.status === "under" ? "低配" : "范围内"}</td></tr>)}</tbody>
          </table>
        </div>
      </Panel>

      <Panel title="现金安全月数构成" help={HELP.liquidityPanel} icon={<WalletCards className="h-5 w-5" />}>
        <Fact label="现金及活钱" value={currency(report.liquidity.liquidAssets)} />
        <Fact label="日常月度资金需求" value={currency(report.liquidity.regularMonthlyRequirement)} note={REGULAR_BASIS[report.liquidity.regularBasis]} />
        <Fact label="年度专项月度预留" value={currency(report.liquidity.specialProjectMonthlyReserve)} note={`剩余专项预算 ${currency(report.liquidity.remainingSpecialBudget)} ÷ ${report.liquidity.remainingMonths} 个月`} />
        <Fact label="合计月度资金需求" value={currency(report.liquidity.plannedMonthlyRequirement)} />
        <Fact label="目标应急资金" value={currency(report.liquidity.targetAmount)} note={report.liquidity.gapAmount === null ? "依据不足" : `当前差额 ${signedCurrency(report.liquidity.gapAmount)}`} />
        {report.liquidity.regularBasis === "actual_average" && <p className="mt-3 text-xs text-muted-foreground">历史支出样本：{report.liquidity.actualSampleMonths} 个月{report.liquidity.usesPartialMonth ? "，包含未结束的本月" : ""}</p>}
      </Panel>

      <Panel title="本年实际收支口径" help={HELP.savingsPanel} icon={<Database className="h-5 w-5" />}>
        <Fact label="统计周期" value={`${report.savings.periodStart} 至 ${report.savings.periodEnd}`} />
        <Fact label="实际收入" value={currency(report.savings.actualIncome)} note={`${report.savings.incomeTransactionCount} 笔记账收入`} />
        <Fact label="实际支出" value={currency(report.savings.actualExpense)} note={`${report.savings.expenseTransactionCount} 笔记账支出，包含年度专项实际支出`} />
        <Fact label="实际净结余" value={signedCurrency(report.savings.netSavings)} />
        <Fact label="年度预计收入" value={currency(report.savings.expectedAnnualIncome)} note={report.savings.expectedIncomeProgressRate === null ? "仅作计划参照，未参与实际储蓄率" : `实际到账进度 ${report.savings.expectedIncomeProgressRate}%`} />
      </Panel>

      <Panel title="保险覆盖事实与资料" help={HELP.insurancePanel} icon={<ShieldCheck className="h-5 w-5" />}>
        <div className="space-y-3">
          {report.insurance.members.map((member) => <div key={member.memberId} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{member.memberName}</strong><span className="text-xs text-muted-foreground">{member.policyCount} 张生效保单</span></div>
            <p className="mt-2 text-xs text-muted-foreground">险种：{member.categories.length ? member.categories.map((category) => INSURANCE_CATEGORY_LABELS[category]).join("、") : "暂无"}</p>
            {Object.keys(member.coverageByCategory).length > 0 && <p className="mt-1 text-xs text-muted-foreground">已记录保额：{(Object.entries(member.coverageByCategory) as Array<[InsuranceCategory, number]>).map(([category, amount]) => `${INSURANCE_CATEGORY_LABELS[category]} ${currency(amount)}`).join("、")}</p>}
            {member.profileMissing.length > 0 && <p className="mt-1 text-xs text-amber-700">成员资料待补：{member.profileMissing.join("、")}</p>}
            {member.policyDataMissing.length > 0 && <p className="mt-1 text-xs text-amber-700">保单资料待补：{member.policyDataMissing.join("、")}</p>}
          </div>)}
          {report.insurance.members.length === 0 && <p className="text-sm text-muted-foreground">暂无生效家庭成员</p>}
        </div>
        <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">年度经常性保费：{currency(report.insurance.recurringAnnualPremium)}；预计收入保费负担率：{rate(report.insurance.premiumBurdenRate)}。本页不输出保障充足度结论。</div>
      </Panel>

      <Panel title="预算执行事实" help={HELP.budgetPanel} icon={<Database className="h-5 w-5" />}>
        <Fact label="本月日常预算" value={report.monthlyBudget.budgetId ? currency(report.monthlyBudget.totalBudget) : "未设置"} note={report.monthlyBudget.executionRate === null ? "无法计算执行率" : `执行率 ${report.monthlyBudget.executionRate}%`} />
        <Fact label="本月日常实际支出" value={currency(report.monthlyBudget.dailyActual)} />
        <Fact label="本月预算外支出" value={currency(report.monthlyBudget.outsideBudgetActual)} />
        <Fact label="年度专项本月支出" value={currency(report.monthlyBudget.specialProjectActual)} note="不占用月度日常预算" />
        <Fact label="年度总预算" value={report.annualBudget.budgetId || report.annualBudget.specialBudget > 0 ? currency(report.annualBudget.totalBudget) : "未设置"} />
        <Fact label="年度预计结余" value={report.annualBudget.budgetId ? currency(report.annualBudget.projectedSurplus) : "无法测算"} note="预计收入减年度日常及专项预算" />
      </Panel>

      <Panel title="投资与负债记录" help={HELP.investmentDebtPanel} icon={<WalletCards className="h-5 w-5" />}>
        <Fact label="已记录投入成本" value={currency(report.investment.totalCost)} note={`${report.investment.trackedAssetCount} 项进攻类资产可计算收益`} />
        <Fact label="对应当前市值" value={currency(report.investment.currentValue)} />
        <Fact label="累计浮动收益" value={signedCurrency(report.investment.totalGain)} note={`收益率 ${rate(report.investment.returnRate)}`} />
        <Fact label="当前负债余额" value={currency(report.debt.totalLiabilities)} note={`资产负债率 ${rate(report.debt.debtToAssetRatio)}`} />
        <Fact label="每月还款" value={currency(report.debt.monthlyPayment)} note={`预计收入偿债率 ${rate(report.debt.annualDebtServiceRate)}`} />
      </Panel>
    </div>

    <Panel title="数据提醒" help={HELP.warningsPanel} icon={<AlertCircle className="h-5 w-5" />}>
      <div className="space-y-2">
        {report.warnings.map((warning) => <div key={warning.code} className={`flex items-start gap-2 rounded-md p-3 text-sm ${warning.level === "warning" ? "bg-amber-50 text-amber-900" : "bg-blue-50 text-blue-900"}`}>{warning.level === "warning" ? <AlertCircle className="mt-0.5 h-4 w-4 flex-none" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />}<span>{warning.message}</span></div>)}
        {report.warnings.length === 0 && <p className="text-sm text-green-700">当前没有发现影响计算的数据缺口。</p>}
      </div>
      <details className="mt-4 rounded-md border p-3 text-sm"><summary className="cursor-pointer font-medium">查看全部计算口径</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-xs text-muted-foreground">{report.methodologyNotes.map((note) => <li key={note}>{note}</li>)}</ul></details>
    </Panel>
  </div>;
}

function Metric({ label, help, value, note, tone = "default" }: { label: string; help: string; value: string; note: string; tone?: "default" | "success" | "danger" }) {
  return <div className="rounded-lg border bg-card p-4"><div className="flex items-center gap-1 text-xs text-muted-foreground"><span>{label}</span><HelpTip label={label} content={help} /></div><p className={`mt-2 text-lg font-bold ${tone === "success" ? "text-green-600" : tone === "danger" ? "text-red-600" : ""}`}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>;
}

function Panel({ title, help, icon, children }: { title: string; help: string; icon: ReactNode; children: ReactNode }) {
  return <section className="rounded-lg border bg-card p-4"><div className="mb-4 flex items-center gap-2 text-primary">{icon}<h3 className="font-medium text-foreground">{title}</h3><HelpTip label={title} content={help} /></div>{children}</section>;
}

function HelpTip({ label, content }: { label: string; content: string }) {
  return <span className="group relative inline-flex flex-none">
    <button type="button" aria-label={`查看${label}的计算说明`} className="rounded-full text-muted-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
      <HelpCircle className="h-4 w-4" />
    </button>
    <span role="tooltip" className="pointer-events-none invisible absolute left-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md bg-slate-900 px-3 py-2 text-left text-xs font-normal leading-5 text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 sm:w-80">
      {content}
    </span>
  </span>;
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="flex items-start justify-between gap-4 border-b py-2 text-sm last:border-0"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}{note && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{note}</span>}</span></div>;
}
