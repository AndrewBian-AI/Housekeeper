import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { Liability, LiabilityType, Asset, Member } from "@caiwu/shared";
import { LIABILITY_TYPE_LABELS } from "@caiwu/shared";
import { Plus, Edit2, Archive, RotateCcw } from "lucide-react";
import { formatCurrency, formatPercent } from "./helpers";
import { memberOptionLabel, selectableMembers } from "@/lib/member-options";

const TYPES = Object.keys(LIABILITY_TYPE_LABELS) as LiabilityType[];

const emptyForm = {
  type: "mortgage" as LiabilityType,
  name: "",
  balance: "",
  originalAmount: "",
  interestRate: "",
  monthlyPayment: "",
  memberId: "",
  linkedAssetId: "",
  note: "",
};

export function LiabilitiesTab({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<Liability[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
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
      const [l, a, m] = await Promise.all([
        api.get<Liability[]>("/liabilities"),
        api.get<Asset[]>("/assets"),
        api.get<Member[]>("/members"),
      ]);
      setItems(l);
      setAssets(a);
      setMembers(m);
    } finally {
      setLoading(false);
    }
  };

  const memberName = (id: string | null) => (id ? members.find((m) => m.id === id)?.name || "未知" : "家庭共有");
  const assetName = (id: string | null) => (id ? assets.find((a) => a.id === id)?.name || "" : "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("负债名称不能为空");
    if (form.balance === "" || Number(form.balance) < 0) return setError("当前剩余本金必须是大于或等于0的数字");
    if (form.originalAmount !== "" && Number(form.originalAmount) < Number(form.balance)) {
      return setError("原始金额不能小于当前剩余本金");
    }
    if (form.interestRate !== "" && (Number(form.interestRate) < 0 || Number(form.interestRate) > 100)) {
      return setError("年利率必须在0%到100%之间");
    }
    const body = {
      type: form.type,
      name: form.name.trim(),
      balance: Number(form.balance),
      originalAmount: form.originalAmount === "" ? null : Number(form.originalAmount),
      interestRate: form.interestRate === "" ? null : Number(form.interestRate),
      monthlyPayment: form.monthlyPayment === "" ? null : Number(form.monthlyPayment),
      memberId: form.memberId || null,
      linkedAssetId: form.linkedAssetId || null,
      note: form.note || null,
    };
    try {
      if (editingId) await api.put(`/liabilities/${editingId}`, body);
      else await api.post("/liabilities", body);
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

  const handleEdit = (l: Liability) => {
    setEditingId(l.id);
    setForm({
      type: l.type,
      name: l.name,
      balance: String(l.balance),
      originalAmount: l.originalAmount == null ? "" : String(l.originalAmount),
      interestRate: l.interestRate == null ? "" : String(l.interestRate),
      monthlyPayment: l.monthlyPayment == null ? "" : String(l.monthlyPayment),
      memberId: l.memberId || "",
      linkedAssetId: l.linkedAssetId || "",
      note: l.note || "",
    });
    setShowForm(true);
  };

  const handleArchive = async (id: string) => {
    if (!confirm("确定归档该负债？归档后不计入当前负债和净资产统计。")) return;
    await api.delete(`/liabilities/${id}`);
    loadData();
    onChanged?.();
  };

  const handleRestore = async (id: string) => {
    await api.put(`/liabilities/${id}`, { isActive: true });
    loadData();
    onChanged?.();
  };

  const visibleItems = items.filter((item) => showArchived || item.isActive);
  const archivedCount = items.filter((item) => !item.isActive).length;
  const formMembers = selectableMembers(members, editingId ? form.memberId : null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">记录房贷、车贷、信用卡等负债，用于计算净资产</p>
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
            <Plus className="h-4 w-4" /> 新增负债
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left">名称</th>
                <th className="px-4 py-3 text-left">类型</th>
                <th className="px-4 py-3 text-right">剩余本金</th>
                <th className="px-4 py-3 text-right">月供</th>
                <th className="px-4 py-3 text-right">年利率</th>
                <th className="px-4 py-3 text-left">关联资产</th>
                <th className="px-4 py-3 text-left">归属</th>
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
                visibleItems.map((l) => (
                  <tr key={l.id} className={`border-b last:border-0 hover:bg-muted/30 ${l.isActive ? "" : "opacity-60"}`}>
                    <td className="px-4 py-2 font-medium">
                      {l.name}
                      {!l.isActive && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">已归档</span>}
                    </td>
                    <td className="px-4 py-2">{LIABILITY_TYPE_LABELS[l.type] || l.type}</td>
                    <td className="px-4 py-2 text-right font-medium text-red-500">{formatCurrency(l.balance)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">
                      {l.monthlyPayment == null ? "-" : formatCurrency(l.monthlyPayment)}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{formatPercent(l.interestRate)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{assetName(l.linkedAssetId) || "-"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{memberName(l.memberId)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {l.isActive ? (
                        <>
                          <button onClick={() => handleEdit(l)} className="p-1 hover:text-primary" title="编辑">
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleArchive(l.id)} className="ml-1 p-1 hover:text-destructive" title="归档">
                            <Archive className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <button onClick={() => handleRestore(l.id)} className="p-1 hover:text-primary" title="恢复使用">
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
            <h3 className="mb-4 font-bold">{editingId ? "编辑负债" : "新增负债"}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
              <input type="text" placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" required />
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LiabilityType })} className="w-full rounded border px-3 py-2 text-sm">
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {LIABILITY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <input type="number" step="0.01" min="0" placeholder="当前剩余本金" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" required />
              <div className="flex gap-2">
                <input type="number" step="0.01" min="0" placeholder="原始金额（可选）" value={form.originalAmount} onChange={(e) => setForm({ ...form, originalAmount: e.target.value })} className="w-full flex-1 rounded border px-3 py-2 text-sm" />
                <input type="number" step="0.01" min="0" placeholder="月供（可选）" value={form.monthlyPayment} onChange={(e) => setForm({ ...form, monthlyPayment: e.target.value })} className="w-full flex-1 rounded border px-3 py-2 text-sm" />
              </div>
              <input type="number" step="0.01" min="0" max="100" placeholder="年利率 %（可选）" value={form.interestRate} onChange={(e) => setForm({ ...form, interestRate: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
              <select value={form.linkedAssetId} onChange={(e) => setForm({ ...form, linkedAssetId: e.target.value })} className="w-full rounded border px-3 py-2 text-sm">
                <option value="">关联资产（如房贷↔房产，可选）</option>
                {assets.filter((a) => a.isActive).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })} className="w-full rounded border px-3 py-2 text-sm">
                <option value="">家庭共有</option>
                {formMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberOptionLabel(m)}
                  </option>
                ))}
              </select>
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
