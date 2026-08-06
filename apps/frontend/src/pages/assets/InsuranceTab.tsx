import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { InsurancePolicy, InsuranceCategory, AssetFrequency, Member, InsuranceAttachment, InsuranceAttachmentType } from "@caiwu/shared";
import { INSURANCE_CATEGORY_LABELS } from "@caiwu/shared";
import { Plus, Edit2, Archive, RotateCcw, Eye, FileText, Upload, Trash2 } from "lucide-react";
import { formatCurrency } from "./helpers";
import { memberOptionLabel, selectableMembers } from "@/lib/member-options";

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
  policyholderMemberId: "",
  policyNumber: "",
  insurer: "",
  coverageAmount: "",
  premium: "",
  premiumFrequency: "" as AssetFrequency | "",
  cashValue: "",
  startDate: "",
  endDate: "",
  claimPhone: "",
  claimContact: "",
  claimContactPhone: "",
  claimChannels: "",
  claimSteps: "",
  claimMaterials: "",
  claimNotes: "",
  note: "",
};

type PolicyDetail = InsurancePolicy & { attachments?: InsuranceAttachment[] };
const ATTACHMENT_LABELS: Record<InsuranceAttachmentType, string> = {
  policy: "电子保单",
  terms: "保险条款",
  payment: "缴费凭证",
  claim_guide: "理赔指南",
  other: "其他资料",
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
  const [detail, setDetail] = useState<PolicyDetail | null>(null);
  const [attachmentType, setAttachmentType] = useState<InsuranceAttachmentType>("policy");
  const [attachmentCaption, setAttachmentCaption] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

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
      policyholderMemberId: form.policyholderMemberId || null,
      policyNumber: form.policyNumber || null,
      insurer: form.insurer || null,
      coverageAmount: form.coverageAmount === "" ? null : Number(form.coverageAmount),
      premium: form.premium === "" ? null : Number(form.premium),
      premiumFrequency: form.premiumFrequency || null,
      cashValue: form.cashValue === "" ? null : Number(form.cashValue),
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      claimPhone: form.claimPhone || null,
      claimContact: form.claimContact || null,
      claimContactPhone: form.claimContactPhone || null,
      claimChannels: form.claimChannels || null,
      claimSteps: form.claimSteps || null,
      claimMaterials: form.claimMaterials || null,
      claimNotes: form.claimNotes || null,
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
      policyholderMemberId: p.policyholderMemberId || "",
      policyNumber: p.policyNumber || "",
      insurer: p.insurer || "",
      coverageAmount: p.coverageAmount == null ? "" : String(p.coverageAmount),
      premium: p.premium == null ? "" : String(p.premium),
      premiumFrequency: p.premiumFrequency || "",
      cashValue: p.cashValue == null ? "" : String(p.cashValue),
      startDate: p.startDate || "",
      endDate: p.endDate || "",
      claimPhone: p.claimPhone || "",
      claimContact: p.claimContact || "",
      claimContactPhone: p.claimContactPhone || "",
      claimChannels: p.claimChannels || "",
      claimSteps: p.claimSteps || "",
      claimMaterials: p.claimMaterials || "",
      claimNotes: p.claimNotes || "",
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
  const formMembers = selectableMembers(
    members,
    editingId ? form.insuredMemberId : null,
    editingId ? form.policyholderMemberId : null
  );

  const openDetail = async (id: string) => {
    setDetail(await api.get<PolicyDetail>(`/insurance/${id}`));
  };

  const uploadAttachment = async () => {
    if (!detail || !attachmentFile) return;
    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", attachmentFile);
      data.append("type", attachmentType);
      data.append("caption", attachmentCaption);
      await api.postForm(`/insurance/${detail.id}/attachments`, data);
      setAttachmentFile(null);
      setAttachmentCaption("");
      await openDetail(detail.id);
    } finally {
      setUploading(false);
    }
  };

  const viewAttachment = async (id: string) => {
    const url = await api.fetchBlobUrl(`/insurance/attachments/${id}/file`);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const deleteAttachment = async (id: string) => {
    if (!detail || !confirm("确定删除这个附件？删除后无法恢复。")) return;
    await api.delete(`/insurance/attachments/${id}`);
    await openDetail(detail.id);
  };

  const editAttachmentCaption = async (item: InsuranceAttachment) => {
    if (!detail) return;
    const caption = prompt("请输入附件说明（留空表示清除说明）", item.caption || "");
    if (caption === null) return;
    await api.put(`/insurance/attachments/${item.id}`, { caption: caption.trim() || null });
    await openDetail(detail.id);
  };

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
                          <button onClick={() => openDetail(p.id)} className="p-1 hover:text-primary" title="查看保单与理赔信息">
                            <Eye className="h-4 w-4" />
                          </button>
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
                  {formMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {memberOptionLabel(m)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <select value={form.policyholderMemberId} onChange={(e) => setForm({ ...form, policyholderMemberId: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm">
                  <option value="">投保人（可选）</option>
                  {formMembers.map((m) => <option key={m.id} value={m.id}>{memberOptionLabel(m)}</option>)}
                </select>
                <input type="text" placeholder="保单号（可选）" value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm" />
              </div>
              <input type="text" placeholder="承保公司（可选）" value={form.insurer} onChange={(e) => setForm({ ...form, insurer: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <input type="number" step="0.01" min="0" placeholder="保额（可选）" value={form.coverageAmount} onChange={(e) => setForm({ ...form, coverageAmount: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm" />
                <input type="number" step="0.01" min="0" placeholder="保费（可选）" value={form.premium} onChange={(e) => setForm({ ...form, premium: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm" />
              </div>
              <div className="rounded border p-3">
                <p className="mb-2 text-sm font-medium">理赔服务信息（均可选）</p>
                <div className="space-y-2">
                  <input type="text" placeholder="理赔电话" value={form.claimPhone} onChange={(e) => setForm({ ...form, claimPhone: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <div className="flex gap-2">
                    <input type="text" placeholder="理赔联系人" value={form.claimContact} onChange={(e) => setForm({ ...form, claimContact: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm" />
                    <input type="text" placeholder="联系人电话" value={form.claimContactPhone} onChange={(e) => setForm({ ...form, claimContactPhone: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm" />
                  </div>
                  <input type="text" placeholder="理赔渠道，如 App、公众号、线下网点" value={form.claimChannels} onChange={(e) => setForm({ ...form, claimChannels: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <textarea rows={2} placeholder="理赔步骤" value={form.claimSteps} onChange={(e) => setForm({ ...form, claimSteps: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <textarea rows={2} placeholder="理赔所需材料" value={form.claimMaterials} onChange={(e) => setForm({ ...form, claimMaterials: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <textarea rows={2} placeholder="理赔注意事项" value={form.claimNotes} onChange={(e) => setForm({ ...form, claimNotes: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                </div>
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

      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setDetail(null)}>
          <div className="my-4 w-full max-w-3xl rounded-lg bg-card p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-lg font-bold">{detail.name}</h3><p className="text-sm text-muted-foreground">{detail.insurer || "未填写保险公司"} · {detail.policyNumber || "未填写保单号"}</p></div>
              <button onClick={() => setDetail(null)} className="rounded border px-3 py-1.5 text-sm">关闭</button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <Info label="投保人" value={memberName(detail.policyholderMemberId)} />
              <Info label="被保险人" value={memberName(detail.insuredMemberId)} />
              <Info label="保障期限" value={`${detail.startDate || "未填写"} ~ ${detail.endDate || "未填写"}`} />
              <Info label="保额" value={detail.coverageAmount == null ? "未填写" : formatCurrency(detail.coverageAmount)} />
              <Info label="理赔电话" value={detail.claimPhone || "未填写"} />
              <Info label="理赔联系人" value={[detail.claimContact, detail.claimContactPhone].filter(Boolean).join(" ") || "未填写"} />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <TextBlock title="理赔渠道" value={detail.claimChannels} />
              <TextBlock title="理赔步骤" value={detail.claimSteps} />
              <TextBlock title="理赔所需材料" value={detail.claimMaterials} />
              <TextBlock title="理赔注意事项" value={detail.claimNotes} />
            </div>
            <section className="mt-6 border-t pt-5">
              <h4 className="font-medium">电子保单与理赔附件（非必填）</h4>
              <div className="mt-3 space-y-2">
                {(detail.attachments || []).map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                    <div className="flex items-center gap-2"><FileText className="h-4 w-4" /><span>{ATTACHMENT_LABELS[item.type]}</span><span className="text-muted-foreground">{item.originalFileName}</span>{item.caption && <span>· {item.caption}</span>}</div>
                    <div>
                      <button onClick={() => viewAttachment(item.id)} className="p-1 hover:text-primary" title="查看或下载"><Eye className="h-4 w-4" /></button>
                      <button onClick={() => editAttachmentCaption(item)} className="ml-1 p-1 hover:text-primary" title="修改附件说明"><Edit2 className="h-4 w-4" /></button>
                      <button onClick={() => deleteAttachment(item.id)} className="ml-1 p-1 hover:text-destructive" title="删除"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
                {!detail.attachments?.length && <p className="text-sm text-muted-foreground">尚未上传附件，不影响保单使用。</p>}
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-[140px_1fr_1fr_auto]">
                <select value={attachmentType} onChange={(e) => setAttachmentType(e.target.value as InsuranceAttachmentType)} className="rounded border px-2 py-2 text-sm">
                  {(Object.keys(ATTACHMENT_LABELS) as InsuranceAttachmentType[]).map((key) => <option key={key} value={key}>{ATTACHMENT_LABELS[key]}</option>)}
                </select>
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.heic" onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)} className="rounded border px-2 py-1.5 text-sm" />
                <input placeholder="附件说明（可选）" value={attachmentCaption} onChange={(e) => setAttachmentCaption(e.target.value)} className="rounded border px-3 py-2 text-sm" />
                <button disabled={!attachmentFile || uploading} onClick={uploadAttachment} className="flex items-center justify-center gap-1 rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"><Upload className="h-4 w-4" /> {uploading ? "上传中" : "上传"}</button>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}

function TextBlock({ title, value }: { title: string; value: string | null }) {
  return <div className="rounded border p-3"><p className="text-sm font-medium">{title}</p><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{value || "未填写"}</p></div>;
}
