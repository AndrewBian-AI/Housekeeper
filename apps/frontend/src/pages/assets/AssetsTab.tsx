import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type {
  Asset,
  AssetLiquidity,
  AssetPurpose,
  AssetRebalanceMode,
  AssetType,
  AllocationBucket,
  AssetValuation,
  Member,
} from "@caiwu/shared";
import {
  ASSET_LIQUIDITY_LABELS,
  ASSET_PURPOSE_LABELS,
  ASSET_REBALANCE_MODE_LABELS,
  ASSET_TYPE_LABELS,
  ASSET_TYPE_DEFAULT_PROFILE,
  ALLOCATION_BUCKET_LABELS,
  ASSET_TYPE_TO_BUCKET,
} from "@caiwu/shared";
import { Plus, Trash2, Edit2, LineChart, Archive, RotateCcw, HelpCircle } from "lucide-react";
import { formatCurrency } from "./helpers";
import { getBusinessToday } from "@/lib/date";
import { memberOptionLabel, selectableMembers } from "@/lib/member-options";

const ASSET_TYPES = Object.keys(ASSET_TYPE_LABELS) as AssetType[];
const BUCKETS = Object.keys(ALLOCATION_BUCKET_LABELS) as AllocationBucket[];
const LIQUIDITIES = Object.keys(ASSET_LIQUIDITY_LABELS) as AssetLiquidity[];
const REBALANCE_MODES = Object.keys(ASSET_REBALANCE_MODE_LABELS) as AssetRebalanceMode[];
const PURPOSES = Object.keys(ASSET_PURPOSE_LABELS) as AssetPurpose[];

const emptyForm = {
  type: "cash" as AssetType,
  name: "",
  amount: "",
  allocationBucket: "liquid" as AllocationBucket,
  liquidity: "immediate" as AssetLiquidity,
  rebalanceMode: "flexible" as AssetRebalanceMode,
  purpose: "daily" as AssetPurpose,
  accountInfo: "",
  costBasis: "",
  memberId: "",
  note: "",
};

export function AssetsTab({ onChanged }: { onChanged?: () => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [valuationFor, setValuationFor] = useState<Asset | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [a, m] = await Promise.all([api.get<Asset[]>("/assets"), api.get<Member[]>("/members")]);
      setAssets(a);
      setMembers(m);
    } finally {
      setLoading(false);
    }
  };

  const memberName = (id: string | null) => (id ? members.find((m) => m.id === id)?.name || "未知" : "家庭共有");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("资产名称不能为空");
    if (form.amount === "" || Number(form.amount) < 0) return setError("当前价值必须是大于或等于0的数字");
    if (form.costBasis !== "" && Number(form.costBasis) < 0) return setError("成本金额不能为负数");
    const body = {
      type: form.type,
      name: form.name.trim(),
      amount: Number(form.amount),
      allocationBucket: form.allocationBucket,
      liquidity: form.liquidity,
      rebalanceMode: form.rebalanceMode,
      purpose: form.purpose,
      accountInfo: form.accountInfo || null,
      costBasis: form.costBasis === "" ? null : Number(form.costBasis),
      memberId: form.memberId || null,
      note: form.note || null,
    };
    try {
      if (editingId) await api.put(`/assets/${editingId}`, body);
      else await api.post("/assets", body);
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

  const handleEdit = (a: Asset) => {
    setEditingId(a.id);
    setForm({
      type: a.type,
      name: a.name,
      amount: String(a.amount),
      allocationBucket: a.allocationBucket,
      liquidity: a.liquidity,
      rebalanceMode: a.rebalanceMode,
      purpose: a.purpose,
      accountInfo: a.accountInfo || "",
      costBasis: a.costBasis == null ? "" : String(a.costBasis),
      memberId: a.memberId || "",
      note: a.note || "",
    });
    setShowForm(true);
  };

  const handleArchive = async (id: string) => {
    if (!confirm("确定归档该资产？归档后不计入当前统计，但估值历史会保留。")) return;
    await api.delete(`/assets/${id}`);
    loadData();
    onChanged?.();
  };

  const handleRestore = async (id: string) => {
    await api.put(`/assets/${id}`, { isActive: true });
    loadData();
    onChanged?.();
  };

  const visibleAssets = assets.filter((asset) => showArchived || asset.isActive);
  const archivedCount = assets.filter((asset) => !asset.isActive).length;
  const formMembers = selectableMembers(members, editingId ? form.memberId : null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">净资产包含所有资产；配置诊断会结合变现能力、调整方式和资金用途，避免把公积金或自用资产当作可直接调仓资金。</p>
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
            <Plus className="h-4 w-4" /> 新增资产
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left">资产名称</th>
                <th className="px-4 py-3 text-left">大类</th>
                <th className="px-4 py-3 text-left">配置象限</th>
                <th className="px-4 py-3 text-left">诊断属性</th>
                <th className="px-4 py-3 text-left">账户信息</th>
                <th className="px-4 py-3 text-right">当前市值</th>
                <th className="px-4 py-3 text-right">成本</th>
                <th className="px-4 py-3 text-left">归属</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted-foreground">
                    加载中...
                  </td>
                </tr>
              ) : visibleAssets.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted-foreground">
                    暂无数据
                  </td>
                </tr>
              ) : (
                visibleAssets.map((a) => (
                  <tr key={a.id} className={`border-b last:border-0 hover:bg-muted/30 ${a.isActive ? "" : "opacity-60"}`}>
                    <td className="px-4 py-2 font-medium">
                      {a.name}
                      {!a.isActive && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">已归档</span>}
                    </td>
                    <td className="px-4 py-2">{ASSET_TYPE_LABELS[a.type] || a.type}</td>
                    <td className="px-4 py-2">{ALLOCATION_BUCKET_LABELS[a.allocationBucket] || a.allocationBucket}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-0.5 text-xs">
                        <span>{ASSET_LIQUIDITY_LABELS[a.liquidity]}</span>
                        <span className="text-muted-foreground">{ASSET_REBALANCE_MODE_LABELS[a.rebalanceMode]} · {ASSET_PURPOSE_LABELS[a.purpose]}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{a.accountInfo || "-"}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatCurrency(a.amount)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">
                      {a.costBasis == null ? "-" : formatCurrency(a.costBasis)}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{memberName(a.memberId)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {a.isActive ? (
                        <>
                          <button onClick={() => setValuationFor(a)} className="p-1 hover:text-primary" title="更新市值/查看趋势">
                            <LineChart className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleEdit(a)} className="ml-1 p-1 hover:text-primary" title="编辑">
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button onClick={() => handleArchive(a.id)} className="ml-1 p-1 hover:text-destructive" title="归档">
                            <Archive className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <button onClick={() => handleRestore(a.id)} className="p-1 hover:text-primary" title="恢复使用">
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
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
          onClick={closeForm}
        >
          <div
            className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-lg bg-card p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 font-bold">{editingId ? "编辑资产" : "新增资产"}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
              <input
                type="text"
                placeholder="资产名称"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded border px-3 py-2 text-sm"
                required
              />
              <div className="flex gap-2">
                <label className="flex-1 text-xs text-muted-foreground">
                  大类
                  <select
                    value={form.type}
                    onChange={(e) => {
                      const type = e.target.value as AssetType;
                      const profile = ASSET_TYPE_DEFAULT_PROFILE[type];
                      setForm({ ...form, type, allocationBucket: ASSET_TYPE_TO_BUCKET[type], ...profile });
                    }}
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  >
                    {ASSET_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {ASSET_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex-1 text-xs text-muted-foreground">
                  配置象限
                  <select
                    value={form.allocationBucket}
                    onChange={(e) => setForm({ ...form, allocationBucket: e.target.value as AllocationBucket })}
                    className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  >
                    {BUCKETS.map((b) => (
                      <option key={b} value={b}>
                        {ALLOCATION_BUCKET_LABELS[b]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="mb-3 text-sm font-medium">诊断属性</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">变现能力<FieldHelp text="决定该资产能否计入现金安全月数。只有“可随时使用”的资金计入当前可用现金；短期可变现资产会单独展示。" /></span>
                    <select value={form.liquidity} onChange={(e) => setForm({ ...form, liquidity: e.target.value as AssetLiquidity })} className="mt-1 w-full rounded border px-2 py-2 text-sm text-foreground">
                      {LIQUIDITIES.map((value) => <option key={value} value={value}>{ASSET_LIQUIDITY_LABELS[value]}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">调整方式<FieldHelp text="“可直接调整”可通过买卖或转账调仓；“仅调整未来新增资金”适合公积金等存量受限、但可改变今后资金安排的资产；“不参与配置调仓”适合自用房、车辆等。" /></span>
                    <select value={form.rebalanceMode} onChange={(e) => setForm({ ...form, rebalanceMode: e.target.value as AssetRebalanceMode })} className="mt-1 w-full rounded border px-2 py-2 text-sm text-foreground">
                      {REBALANCE_MODES.map((value) => <option key={value} value={value}>{ASSET_REBALANCE_MODE_LABELS[value]}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">资金用途<FieldHelp text="用于区分日常周转、应急储备、养老、自用等目的，帮助 AI 避免只看比例给出机械的买卖建议。" /></span>
                    <select value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value as AssetPurpose })} className="mt-1 w-full rounded border px-2 py-2 text-sm text-foreground">
                      {PURPOSES.map((value) => <option key={value} value={value}>{ASSET_PURPOSE_LABELS[value]}</option>)}
                    </select>
                  </label>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">系统会按资产大类给出默认值，请根据真实情况复核；这些属性不会改变资产金额。</p>
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="当前市值或余额"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full rounded border px-3 py-2 text-sm"
                required
              />
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="投入成本（投资类填，用于算收益，可选）"
                value={form.costBasis}
                onChange={(e) => setForm({ ...form, costBasis: e.target.value })}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="具体账户信息，如 程伟光-招行（可选）"
                value={form.accountInfo}
                onChange={(e) => setForm({ ...form, accountInfo: e.target.value })}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <select
                value={form.memberId}
                onChange={(e) => setForm({ ...form, memberId: e.target.value })}
                className="w-full rounded border px-3 py-2 text-sm"
              >
                <option value="">家庭共有</option>
                {formMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberOptionLabel(m)}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="备注（可选）"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className="w-full rounded border px-3 py-2 text-sm"
              />
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

      {valuationFor && (
        <ValuationModal
          asset={valuationFor}
          onClose={() => setValuationFor(null)}
          onSaved={() => {
            loadData();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function FieldHelp({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <HelpCircle className="h-3.5 w-3.5 cursor-help" />
      <span role="tooltip" className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-64 rounded bg-slate-900 px-3 py-2 text-xs leading-5 text-white opacity-0 shadow-lg group-hover:visible group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

function ValuationModal({ asset, onClose, onSaved }: { asset: Asset; onClose: () => void; onSaved: () => void }) {
  const [history, setHistory] = useState<AssetValuation[]>([]);
  const [date, setDate] = useState(getBusinessToday());
  const [value, setValue] = useState(String(asset.amount));
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<AssetValuation[]>(`/assets/${asset.id}/valuations`).then(setHistory);
  }, [asset.id]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/assets/${asset.id}/valuations`, { date, value: Number(value) });
      const next = await api.get<AssetValuation[]>(`/assets/${asset.id}/valuations`);
      setHistory(next);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "估值保存失败");
    }
  };

  const remove = async (vid: string) => {
    if (!confirm("确定删除这条估值？如果它是最新记录，当前价值会自动恢复为上一条估值。")) return;
    await api.delete(`/assets/valuations/${vid}`);
    setHistory(await api.get<AssetValuation[]>(`/assets/${asset.id}/valuations`));
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-lg bg-card p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 font-bold">{asset.name} · 市值记录</h3>
        <p className="mb-4 text-xs text-muted-foreground">记录每次市值；同一天重复记录会更新原值，最新记录会同步为当前价值</p>
        {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <form onSubmit={save} className="mb-4 flex gap-2">
          <input type="date" max={getBusinessToday()} value={date} onChange={(e) => setDate(e.target.value)} className="rounded border px-2 py-2 text-sm" required />
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="市值"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1 rounded border px-3 py-2 text-sm"
            required
          />
          <button type="submit" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground">
            记录
          </button>
        </form>
        <div className="space-y-1">
          {history.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">暂无记录</p>
          ) : (
            history.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <span className="text-muted-foreground">{h.date}</span>
                <span className="font-medium">{formatCurrency(h.value)}</span>
                <button onClick={() => remove(h.id)} className="p-1 hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded border px-4 py-2 text-sm">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
