import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { InsurancePolicy, InsuranceCategory, AssetFrequency, Member } from "@caiwu/shared";
import { INSURANCE_CATEGORY_LABELS } from "@caiwu/shared";
import { Plus, Edit2, Archive, RotateCcw } from "lucide-react";
import { formatCurrency } from "./helpers";

const CATEGORIES = Object.keys(INSURANCE_CATEGORY_LABELS) as InsuranceCategory[];
const FREQ_LABELS: Record<AssetFrequency, string> = {
  monthly: "每月",
  quarterly: "每季",
  yearly: "每年",
  "one-time": "一次性",
};

const emptyForm = {
  name: "",
  category: "medical" as InsuranceCategory,
  insuredMemberId: "",
  insurer: "",
  coverageAmount: "",
  premium: "",
  premiumFrequency: "" as AssetFrequency | "",
  cashValue: "",
  startDate: "",
  endDate: "",
  note: "",
};

export function InsuranceTab({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<InsurancePolicy[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [i, m] = await Promise.all([api.get<InsurancePolicy[]>("/insurance"), api.get<Member[]>("/members")]);
      setItems(i);
      setMembers(m);
    } finally {
      setLoading(false);
    }
  };

  const memberName = (id: string | null) => (id ? members.find((m) => m.id === id)?.name || "未知" : "-");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("保单名称不能为空");
    for (const [value, label] of [
      [form.coverageAmount, "保额"],
      [form.premium, "保费"],
      [form.cashValue, "现金价值"],
    ] as const) {
      if (value !== "" && Number(value) < 0) return setError(`${label}不能为负数`);
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      return setError("保险结束日期不能早于开始日期");
    }
    const body = {
      name: form.name.trim(),
      category: form.category,
      insuredMemberId: form.insuredMemberId || null,
      insurer: form.insurer || null,
      coverageAmount: form.coverageAmount === "" ? null : Number(form.coverageAmount),
      premium: form.premium === "" ? null : Number(form.premium),
      premiumFrequency: form.premiumFrequency || null,
      cashValue: form.cashValue === "" ? null : Number(form.cashValue),
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      note: form.note || null,
    };
    try {
      if (editingId) await api.put(`/insurance/${editingId}`, body);
      else await api.post("/insurance", body);
      closeForm();
      loadData();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  };

  const handleEdit = (p: InsurancePolicy) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      category: p.category,
      insuredMemberId: p.insuredMemberId || "",
      insurer: p.insurer || "",
      coverageAmount: p.coverageAmount == null ? "" : String(p.coverageAmount),
      premium: p.premium == null ? "" : String(p.premium),
      premiumFrequency: p.premiumFrequency || "",
      cashValue: p.cashValue == null ? "" : String(p.cashValue),
      startDate: p.startDate || "",
      endDate: p.endDate || "",
      note: p.note || "",
    });
    setShowForm(true);
  };

  const handleArchive = async (id: string) => {
    if (!confirm("确定归档该保单？归档后现金价值不再计入当前资产统计。")) return;
    await api.delete(`/insurance/${id}`);
    loadData();
    onChanged?.();
  };

  const handleRestore = async (id: string) => {
    await api.put(`/insurance/${id}`, { isActive: true });
    loadData();
    onChanged?.();
  };

  const visibleItems = items.filter((item) => showArchived || item.isActive);
  const archivedCount = items.filter((item) => !item.isActive).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">记录社保、商业医疗、寿险等保单；填写「现金价值」会计入净资产的保障部分</p>
        <div className="flex gap-2">
          {archivedCount > 0 && (
            <button onClick={() => setShowArchived((value) => !value)} className="rounded-md border px-3 py-2 text-sm">
              {showArchived ? "隐藏已归档" : `查看已归档（${archivedCount}）`}
            </button>
          )}
          <button
            onClick={() => {
              setForm(emptyForm);
              setEditingId(null);
              setShowForm(true);
            }}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> 新增保单
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left">名称</th>
                <th className="px-4 py-3 text-left">险种</th>
                <th className="px-4 py-3 text-left">被保人</th>
                <th className="px-4 py-3 text-right">保额</th>
                <th className="px-4 py-3 text-right">保费</th>
                <th className="px-4 py-3 text-right">现金价值</th>
                <th className="px-4 py-3 text-left">备注</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    加载中...
                  </td>
                </tr>
              ) : visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    暂无数据
                  </td>
                </tr>
              ) : (
                visibleItems.map((p) => (
                  <tr key={p.id} className={`border-b last:border-0 hover:bg-muted/30 ${p.isActive ? "" : "opacity-60"}`}>
                    <td className="px-4 py-2 font-medium">
                      {p.name}
                      {!p.isActive && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">已归档</span>}
                    </td>
                    <td className="px-4 py-2">{INSURANCE_CATEGORY_LABELS[p.category] || p.category}</td>
                    <td className="px-4 py-2 text-muted-foreground">{memberName(p.insuredMemberId)}</td>
                    <td className="px-4 py-2 text-right">{p.coverageAmount == null ? "-" : formatCurrency(p.coverageAmount)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">
                      {p.premium == null ? "-" : formatCurrency(p.premium)}
                      {p.premium != null && p.premiumFrequency ? `/${FREQ_LABELS[p.premiumFrequency]}` : ""}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{p.cashValue == null ? "-" : formatCurrency(p.cashValue)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{p.note || "-"}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {p.isActive ? (
                        <>
                          <button onClick={() => handleEdit(p)} className="p-1 hover:text-primary" title="编辑">
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleArchive(p.id)} className="ml-1 p-1 hover:text-destructive" title="归档">
                            <Archive className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <button onClick={() => handleRestore(p.id)} className="p-1 hover:text-primary" title="恢复使用">
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" onClick={closeForm}>
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-lg bg-card p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-bold">{editingId ? "编辑保单" : "新增保单"}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
              <input type="text" placeholder="保单名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" required />
              <div className="flex gap-2">
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as InsuranceCategory })} className="flex-1 rounded border px-3 py-2 text-sm">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {INSURANCE_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
                <select value={form.insuredMemberId} onChange={(e) => setForm({ ...form, insuredMemberId: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm">
                  <option value="">被保人（可选）</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <input type="text" placeholder="承保公司（可选）" value={form.insurer} onChange={(e) => setForm({ ...form, insurer: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <input type="number" step="0.01" min="0" placeholder="保额（可选）" value={form.coverageAmount} onChange={(e) => setForm({ ...form, coverageAmount: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm" />
                <input type="number" step="0.01" min="0" placeholder="保费（可选）" value={form.premium} onChange={(e) => setForm({ ...form, premium: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2">
                <select value={form.premiumFrequency} onChange={(e) => setForm({ ...form, premiumFrequency: e.target.value as AssetFrequency | "" })} className="flex-1 rounded border px-3 py-2 text-sm">
                  <option value="">缴费频率（可选）</option>
                  {(Object.keys(FREQ_LABELS) as AssetFrequency[]).map((f) => (
                    <option key={f} value={f}>
                      {FREQ_LABELS[f]}
                    </option>
                  ))}
                </select>
                <input type="number" step="0.01" min="0" placeholder="现金价值（可选，计入净资产）" value={form.cashValue} onChange={(e) => setForm({ ...form, cashValue: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2">
                <label className="flex-1 text-xs text-muted-foreground">
                  开始日期（可选）
                  <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                </label>
                <label className="flex-1 text-xs text-muted-foreground">
                  结束日期（可选）
                  <input type="date" min={form.startDate || undefined} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
                </label>
              </div>
              <input type="text" placeholder="备注（可选）" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeForm} className="rounded border px-4 py-2 text-sm">
                  取消
                </button>
                <button type="submit" className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
