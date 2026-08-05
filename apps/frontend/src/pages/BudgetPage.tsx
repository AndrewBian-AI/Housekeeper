import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import type {
  AnnualBudgetExecution,
  AnnualProject,
  Category,
  MonthlyBudgetExecution,
} from "@caiwu/shared";
import { Archive, Calculator, Copy, Edit2, HelpCircle, Plus, RotateCcw } from "lucide-react";
import { getBusinessToday } from "@/lib/date";

type Tab = "monthly" | "annual" | "projects";
type AmountMap = Record<string, string>;

const money = (value: number) => `¥${value.toFixed(2)}`;
const today = getBusinessToday();
const currentMonth = today.slice(0, 7);
const currentYear = Number(today.slice(0, 4));

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "exceeded"
      ? "bg-red-100 text-red-700"
      : status === "warning"
        ? "bg-amber-100 text-amber-700"
        : "bg-green-100 text-green-700";
  return <span className={`rounded px-2 py-0.5 text-xs ${styles}`}>{status === "exceeded" ? "已超支" : status === "warning" ? "预警" : "正常"}</span>;
}

export function BudgetPage() {
  const [tab, setTab] = useState<Tab>("monthly");
  const [categories, setCategories] = useState<Category[]>([]);
  const expenseCategories = useMemo(
    () => categories.filter((item) => item.type === "expense"),
    [categories]
  );

  useEffect(() => {
    api.get<Category[]>("/categories").then(setCategories);
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">预算管理</h2>
        <p className="mt-1 text-sm text-muted-foreground">用预算为家庭开支建立参照；年度专项用于旅游、装修等非日常计划。</p>
      </div>
      <div className="flex gap-1 rounded-lg border bg-card p-1">
        {([
          ["monthly", "月度预算"],
          ["annual", "年度预算"],
          ["projects", "年度专项"],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`rounded-md px-4 py-2 text-sm ${tab === key ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "monthly" && <MonthlyBudgetPanel categories={expenseCategories} />}
      {tab === "annual" && <AnnualBudgetPanel categories={expenseCategories} />}
      {tab === "projects" && <AnnualProjectsPanel />}
    </div>
  );
}

function MonthlyBudgetPanel({ categories }: { categories: Category[] }) {
  const [month, setMonth] = useState(currentMonth);
  const [execution, setExecution] = useState<MonthlyBudgetExecution | null>(null);
  const [total, setTotal] = useState("");
  const [note, setNote] = useState("");
  const [amounts, setAmounts] = useState<AmountMap>({});
  const [error, setError] = useState("");

  const load = async () => {
    const data = await api.get<MonthlyBudgetExecution>(`/budgets/monthly/${month}`);
    setExecution(data);
    setTotal(data.budgetId ? String(data.totalBudget) : "");
    setNote(data.note || "");
    setAmounts(Object.fromEntries(data.categoryLines.map((item) => [item.categoryId, String(item.budgetAmount)])));
  };
  useEffect(() => void load(), [month]);

  const editableCategories = categories.filter(
    (category) =>
      category.isActive ||
      execution?.categoryLines.some((line) => line.categoryId === category.id)
  );
  const allocated = Object.values(amounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const save = async () => {
    setError("");
    try {
      const data = await api.put<MonthlyBudgetExecution>(`/budgets/monthly/${month}`, {
        totalAmount: Number(total) || 0,
        note: note || null,
        items: editableCategories
          .filter((item) => Number(amounts[item.id]) > 0)
          .map((item) => ({ categoryId: item.id, amount: Number(amounts[item.id]) })),
      });
      setExecution(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };
  const copyPrevious = async () => {
    const date = new Date(`${month}-01T00:00:00`);
    date.setMonth(date.getMonth() - 1);
    const sourceMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!confirm(`确定使用 ${sourceMonth} 的预算覆盖当前编辑内容？`)) return;
    try {
      await api.post(`/budgets/monthly/${month}/copy`, { sourceMonth });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "复制失败");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border px-3 py-2 text-sm" />
        <button onClick={copyPrevious} className="flex items-center gap-1 rounded border px-3 py-2 text-sm"><Copy className="h-4 w-4" /> 从上月复制</button>
      </div>
      {execution && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Metric label="月度日常预算" value={money(execution.totalBudget)} />
          <Metric label="日常实际支出" value={money(execution.dailyActual)} />
          <Metric label="预算外支出" value={money(execution.outsideBudgetActual)} tone={execution.outsideBudgetActual > 0 ? "warning" : undefined} />
          <Metric label="年度专项支出" value={money(execution.specialProjectActual)} />
          <Metric label="全部现金支出" value={money(execution.allExpense)} />
          <Metric label="预算执行率" value={execution.executionRate === null ? "未设置" : `${execution.executionRate}%`} tone={(execution.executionRate || 0) >= 100 ? "danger" : undefined} />
        </div>
      )}
      <section className="rounded-lg border bg-card p-4">
        <h3 className="font-medium">维护月度预算</h3>
        {error && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm">月度总预算<input type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm">备注<input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {editableCategories.map((category) => (
            <label key={category.id} className={`flex items-center justify-between gap-3 rounded border p-3 text-sm ${category.isActive ? "" : "border-amber-300 bg-amber-50/50"}`}>
              <span>{category.icon} {category.name}{!category.isActive && <span className="ml-1 text-xs text-amber-700">（已归档）</span>}</span>
              <input type="number" min="0" step="0.01" placeholder="不设置" value={amounts[category.id] || ""} onChange={(e) => setAmounts({ ...amounts, [category.id]: e.target.value })} className="w-28 rounded border px-2 py-1.5 text-right" />
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className={(Number(total) || 0) < allocated ? "text-red-600" : "text-muted-foreground"}>
            已分配 {money(allocated)} · 未分配 {money((Number(total) || 0) - allocated)}
          </span>
          <button onClick={save} className="rounded bg-primary px-4 py-2 text-primary-foreground">保存预算</button>
        </div>
      </section>
      {execution && <ExecutionTables execution={execution} />}
    </div>
  );
}

function ExecutionTables({ execution }: { execution: MonthlyBudgetExecution }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="overflow-hidden rounded-lg border bg-card">
        <h3 className="border-b px-4 py-3 font-medium">预算内分类支出</h3>
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50"><th className="px-3 py-2 text-left">分类</th><th className="px-3 py-2 text-right">预算</th><th className="px-3 py-2 text-right">实际</th><th className="px-3 py-2 text-right">状态</th></tr></thead>
          <tbody>{execution.categoryLines.length ? execution.categoryLines.map((item) => (
            <tr key={item.categoryId} className="border-b last:border-0"><td className="px-3 py-2">{item.categoryName}</td><td className="px-3 py-2 text-right">{money(item.budgetAmount)}</td><td className="px-3 py-2 text-right">{money(item.actualAmount)}<span className="ml-1 text-xs text-muted-foreground">{item.executionRate ?? 0}%</span></td><td className="px-3 py-2 text-right"><StatusBadge status={item.status} /></td></tr>
          )) : <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">尚未设置分类预算</td></tr>}</tbody>
        </table>
      </section>
      <div className="space-y-5">
        <section className="rounded-lg border bg-card p-4">
          <h3 className="font-medium">预算外支出</h3>
          {execution.outsideBudgetLines.length ? execution.outsideBudgetLines.map((item) => (
            <div key={item.categoryId} className="mt-3 flex justify-between text-sm"><span>{item.categoryName} · {item.transactionCount}笔</span><span className="font-medium text-amber-700">{money(item.actualAmount)}</span></div>
          )) : <p className="mt-3 text-sm text-muted-foreground">本月没有预算外支出</p>}
        </section>
        <section className="rounded-lg border bg-card p-4">
          <h3 className="font-medium">年度专项在本月发生的支出</h3>
          {execution.specialProjects.length ? execution.specialProjects.map((item) => (
            <div key={item.id} className="mt-3 flex justify-between text-sm"><span>{item.name}</span><span>{money(item.actualAmount || 0)} / {money(item.budgetAmount)}</span></div>
          )) : <p className="mt-3 text-sm text-muted-foreground">本月没有年度专项支出</p>}
        </section>
      </div>
    </div>
  );
}

function AnnualBudgetPanel({ categories }: { categories: Category[] }) {
  const [year, setYear] = useState(currentYear);
  const [execution, setExecution] = useState<AnnualBudgetExecution | null>(null);
  const [expectedIncome, setExpectedIncome] = useState("");
  const [regularBudget, setRegularBudget] = useState("");
  const [note, setNote] = useState("");
  const [amounts, setAmounts] = useState<AmountMap>({});
  const [sourceMonth, setSourceMonth] = useState(currentMonth);
  const [error, setError] = useState("");
  const [showCalculation, setShowCalculation] = useState(false);

  const load = async () => {
    const data = await api.get<AnnualBudgetExecution>(`/budgets/annual/${year}`);
    setExecution(data);
    setExpectedIncome(data.budgetId ? String(data.expectedIncome) : "");
    setRegularBudget(data.budgetId ? String(data.regularBudget) : "");
    setNote(data.note || "");
    setAmounts(Object.fromEntries(data.categoryLines.map((item) => [item.categoryId, String(item.budgetAmount)])));
  };
  useEffect(() => void load(), [year]);

  const editableCategories = categories.filter(
    (category) =>
      category.isActive ||
      execution?.categoryLines.some((line) => line.categoryId === category.id)
  );
  const save = async () => {
    setError("");
    try {
      await api.put(`/budgets/annual/${year}`, {
        expectedIncome: Number(expectedIncome) || 0,
        regularBudgetAmount: Number(regularBudget) || 0,
        note: note || null,
        items: editableCategories.filter((item) => Number(amounts[item.id]) > 0).map((item) => ({ categoryId: item.id, amount: Number(amounts[item.id]) })),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };
  const generate = async () => {
    if (!confirm(`确定根据 ${sourceMonth} 的预算生成 ${year} 年年度预算草稿？`)) return;
    try {
      await api.post(`/budgets/annual/${year}/generate`, { sourceMonth });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    }
  };
  const specialBudget = execution?.specialProjects.filter((item) => item.isActive).reduce((sum, item) => sum + item.budgetAmount, 0) || 0;
  const plannedExpense = (Number(regularBudget) || 0) + specialBudget;
  const projectedSurplus = (Number(expectedIncome) || 0) - plannedExpense;
  const savingsRate = Number(expectedIncome) > 0 ? projectedSurplus / Number(expectedIncome) * 100 : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <input type="number" min="2000" max="2200" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28 rounded border px-3 py-2 text-sm" />
        <input type="month" value={sourceMonth} onChange={(e) => setSourceMonth(e.target.value)} className="rounded border px-3 py-2 text-sm" />
        <button onClick={generate} className="flex items-center gap-1 rounded border px-3 py-2 text-sm"><Copy className="h-4 w-4" /> 根据月度预算生成</button>
      </div>
      {execution && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Metric label="预计收入" value={money(execution.expectedIncome)} />
          <Metric label="预计总支出" value={money(execution.totalBudget)} />
          <Metric label="预计结余" value={money(execution.projectedSurplus)} tone={execution.projectedSurplus < 0 ? "danger" : undefined} />
          <Metric label="实际收入" value={money(execution.actualIncome)} />
          <Metric label="实际支出" value={money(execution.totalActual)} />
          <Metric label="当前实际结余" value={money(execution.actualSurplus)} tone={execution.actualSurplus < 0 ? "danger" : undefined} />
        </div>
      )}
      <section className="rounded-lg border bg-card p-4">
        <h3 className="font-medium">维护年度预算</h3>
        {error && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="text-sm">年度预计收入<input type="number" min="0" step="0.01" value={expectedIncome} onChange={(e) => setExpectedIncome(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm">年度日常预算<input type="number" min="0" step="0.01" value={regularBudget} onChange={(e) => setRegularBudget(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm">备注<input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {editableCategories.map((category) => (
            <label key={category.id} className={`flex items-center justify-between gap-3 rounded border p-3 text-sm ${category.isActive ? "" : "border-amber-300 bg-amber-50/50"}`}>
              <span>{category.icon} {category.name}{!category.isActive && <span className="ml-1 text-xs text-amber-700">（已归档）</span>}</span>
              <input type="number" min="0" step="0.01" value={amounts[category.id] || ""} onChange={(e) => setAmounts({ ...amounts, [category.id]: e.target.value })} className="w-28 rounded border px-2 py-1.5 text-right" />
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setShowCalculation(true)} className="flex items-center gap-1 rounded border px-4 py-2 text-sm"><Calculator className="h-4 w-4" /> 年度结余测算</button>
          <button onClick={save} className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">保存预算</button>
        </div>
        {showCalculation && (
          <div className={`mt-4 rounded-lg border p-4 ${projectedSurplus < 0 ? "border-red-300 bg-red-50" : "bg-muted/40"}`}>
            <div className="grid gap-2 text-sm sm:grid-cols-3"><span>预计总支出：{money(plannedExpense)}</span><span>预计结余：<b>{money(projectedSurplus)}</b></span><span>预计结余率：{savingsRate === null ? "无法计算" : `${savingsRate.toFixed(2)}%`}</span></div>
            {projectedSurplus < 0 && <p className="mt-2 text-sm text-red-700">当前预算预计出现赤字，建议调整日常预算或年度专项金额。</p>}
          </div>
        )}
      </section>
      {execution && (
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="rounded-lg border bg-card p-4">
            <h3 className="font-medium">年度日常预算执行</h3>
            {execution.categoryLines.map((item) => <div key={item.categoryId} className="mt-3 flex items-center justify-between text-sm"><span>{item.categoryName}</span><span>{money(item.actualAmount)} / {money(item.budgetAmount)} · {item.executionRate ?? 0}%</span></div>)}
            {execution.outsideBudgetLines.length > 0 && <div className="mt-4 border-t pt-3"><p className="font-medium text-amber-700">年度预算外支出</p>{execution.outsideBudgetLines.map((item) => <div key={item.categoryId} className="mt-2 flex justify-between text-sm"><span>{item.categoryName}</span><span>{money(item.actualAmount)}</span></div>)}</div>}
          </section>
          <section className="rounded-lg border bg-card p-4">
            <h3 className="font-medium">年度专项执行</h3>
            {execution.specialProjects.length ? execution.specialProjects.map((item) => <div key={item.id} className="mt-3 flex justify-between text-sm"><span>{item.name}</span><span>{money(item.actualAmount || 0)} / {money(item.budgetAmount)}</span></div>) : <p className="mt-3 text-sm text-muted-foreground">本年度尚未维护专项</p>}
          </section>
        </div>
      )}
    </div>
  );
}

const emptyProject = { name: "", budgetAmount: "", startDate: "", endDate: "", keywords: "", note: "" };

function AnnualProjectsPanel() {
  const [year, setYear] = useState(currentYear);
  const [projects, setProjects] = useState<AnnualProject[]>([]);
  const [form, setForm] = useState(emptyProject);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const load = () => api.get<AnnualProject[]>(`/budgets/projects?year=${year}`).then(setProjects);
  useEffect(() => void load(), [year]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const body = { year, name: form.name, budgetAmount: Number(form.budgetAmount), startDate: form.startDate || null, endDate: form.endDate || null, keywords: form.keywords, note: form.note || null };
    try {
      if (editingId) await api.put(`/budgets/projects/${editingId}`, body);
      else await api.post("/budgets/projects", body);
      setShowForm(false); setEditingId(null); setForm(emptyProject); load();
    } catch (err) { setError(err instanceof Error ? err.message : "保存失败"); }
  };
  const edit = (item: AnnualProject) => {
    setEditingId(item.id);
    setForm({ name: item.name, budgetAmount: String(item.budgetAmount), startDate: item.startDate || "", endDate: item.endDate || "", keywords: item.keywords.join("，"), note: item.note || "" });
    setShowForm(true);
  };
  const toggle = async (item: AnnualProject) => {
    if (item.isActive) await api.delete(`/budgets/projects/${item.id}`);
    else await api.put(`/budgets/projects/${item.id}`, { isActive: true });
    load();
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input type="number" min="2000" max="2200" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28 rounded border px-3 py-2 text-sm" />
        <button onClick={() => { setEditingId(null); setForm(emptyProject); setShowForm(true); }} className="flex items-center gap-1 rounded bg-primary px-3 py-2 text-sm text-primary-foreground"><Plus className="h-4 w-4" /> 新增年度专项</button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((item) => (
          <div key={item.id} className={`rounded-lg border bg-card p-4 ${item.isActive ? "" : "opacity-60"}`}>
            <div className="flex justify-between gap-3"><div><h3 className="font-medium">{item.name}</h3><p className="mt-1 text-xl font-bold">{money(item.budgetAmount)}</p></div><span className="text-xs text-muted-foreground">{item.year}</span></div>
            <p className="mt-3 text-sm text-muted-foreground">关键词：{item.keywords.join("、") || "未设置（微信不会通过关键词自动归类）"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{item.startDate || "未设开始日期"} ~ {item.endDate || "未设结束日期"}</p>
            <div className="mt-4 flex justify-end gap-1"><button onClick={() => edit(item)} className="p-1 hover:text-primary"><Edit2 className="h-4 w-4" /></button><button onClick={() => toggle(item)} className="p-1 hover:text-primary">{item.isActive ? <Archive className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}</button></div>
          </div>
        ))}
        {!projects.length && <p className="text-sm text-muted-foreground">该年份尚未维护年度专项。</p>}
      </div>
      {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowForm(false)}><div className="w-full max-w-lg rounded-lg bg-card p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold">{editingId ? "编辑年度专项" : "新增年度专项"}</h3>
        <form onSubmit={submit} className="mt-4 space-y-3">
          {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">所属年份<input type="number" value={year} disabled className="mt-1 w-full rounded border bg-muted px-3 py-2" /></label><label className="text-sm">专项名称<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label></div>
          <label className="text-sm">预算金额<input required type="number" min="0" step="0.01" value={form.budgetAmount} onChange={(e) => setForm({ ...form, budgetAmount: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">预计开始日期<input type="date" min={`${year}-01-01`} max={`${year}-12-31`} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm">预计结束日期<input type="date" min={`${year}-01-01`} max={`${year}-12-31`} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label></div>
          <label className="text-sm"><span className="flex items-center gap-1">微信识别关键词（可选）<span title="关键词用于微信自动识别年度专项，例如云南旅行可填写：云南、昆明、大理、丽江。建议使用含义明确的词语。"><HelpCircle className="h-4 w-4 text-muted-foreground" /></span></span><textarea rows={2} value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="用逗号或换行分隔" className="mt-1 w-full rounded border px-3 py-2" /></label>
          <label className="text-sm">说明（可选）<textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowForm(false)} className="rounded border px-4 py-2 text-sm">取消</button><button className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">保存</button></div>
        </form>
      </div></div>}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warning" }) {
  return <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-2 text-xl font-bold ${tone === "danger" ? "text-red-600" : tone === "warning" ? "text-amber-700" : ""}`}>{value}</p></div>;
}
