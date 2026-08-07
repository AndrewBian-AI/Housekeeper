import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { InsurancePolicy, InsuranceCategory, AssetFrequency, Member, InsuranceAttachment, InsuranceAttachmentType, InsuranceRenewalType } from "@caiwu/shared";
import { INSURANCE_CATEGORY_LABELS } from "@caiwu/shared";
import { Plus, Edit2, Archive, RotateCcw, Eye, FileText, Upload, Trash2, Copy, ClipboardPaste, CircleAlert, CircleCheck } from "lucide-react";
import { formatCurrency } from "./helpers";
import { memberOptionLabel, selectableMembers } from "@/lib/member-options";
import { buildInsuranceExtractionPrompt, parseInsuranceExtraction } from "@/lib/insurance-extraction";

const CATEGORIES = Object.keys(INSURANCE_CATEGORY_LABELS) as InsuranceCategory[];
const FREQ_LABELS: Record<AssetFrequency, string> = {
  monthly: "每月",
  quarterly: "每季",
  yearly: "每年",
  "one-time": "一次性",
};
const RENEWAL_LABELS: Record<InsuranceRenewalType, string> = {
  guaranteed: "保证续保",
  review_required: "续保需审核",
  non_guaranteed: "不保证续保",
  not_applicable: "不适用",
  unknown: "文件未说明",
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
  coverageSummary: "",
  coverageTerm: "",
  deductible: "",
  reimbursementRatio: "",
  waitingPeriodDays: "",
  renewalType: "" as InsuranceRenewalType | "",
  renewalUntilAge: "",
  annualLimit: "",
  beneficiary: "",
  keyClauses: "",
  keyExclusions: "",
  reviewedAt: "",
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
interface ReadinessMember {
  memberId: string;
  memberName: string;
  profileMissing: string[];
  policyCount: number;
  categories: InsuranceCategory[];
  policyMissing: Array<{ policyId: string; policyName: string; field: string }>;
}
interface InsuranceReadiness {
  memberCount: number;
  policyCount: number;
  unassignedPolicyCount: number;
  members: ReadinessMember[];
}
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
  const [readiness, setReadiness] = useState<InsuranceReadiness | null>(null);
  const [extractionText, setExtractionText] = useState("");
  const [extractionMessage, setExtractionMessage] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [i, m, r] = await Promise.all([
        api.get<InsurancePolicy[]>("/insurance"),
        api.get<Member[]>("/members"),
        api.get<InsuranceReadiness>("/insurance/readiness"),
      ]);
      setItems(i);
      setMembers(m);
      setReadiness(r);
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
      [form.deductible, "免赔额"],
      [form.annualLimit, "年度赔付限额"],
    ] as const) {
      if (value !== "" && Number(value) < 0) return setError(`${label}不能为负数`);
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      return setError("保险结束日期不能早于开始日期");
    }
    if (form.reimbursementRatio !== "" && (Number(form.reimbursementRatio) < 0 || Number(form.reimbursementRatio) > 100)) {
      return setError("赔付比例必须在0至100之间");
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
      coverageSummary: form.coverageSummary || null,
      coverageTerm: form.coverageTerm || null,
      deductible: form.deductible === "" ? null : Number(form.deductible),
      reimbursementRatio: form.reimbursementRatio === "" ? null : Number(form.reimbursementRatio),
      waitingPeriodDays: form.waitingPeriodDays === "" ? null : Number(form.waitingPeriodDays),
      renewalType: form.renewalType || null,
      renewalUntilAge: form.renewalUntilAge === "" ? null : Number(form.renewalUntilAge),
      annualLimit: form.annualLimit === "" ? null : Number(form.annualLimit),
      beneficiary: form.beneficiary || null,
      keyClauses: form.keyClauses || null,
      keyExclusions: form.keyExclusions || null,
      reviewedAt: form.reviewedAt || null,
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
    setExtractionText("");
    setExtractionMessage("");
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
      coverageSummary: p.coverageSummary || "",
      coverageTerm: p.coverageTerm || "",
      deductible: p.deductible == null ? "" : String(p.deductible),
      reimbursementRatio: p.reimbursementRatio == null ? "" : String(p.reimbursementRatio),
      waitingPeriodDays: p.waitingPeriodDays == null ? "" : String(p.waitingPeriodDays),
      renewalType: p.renewalType || "",
      renewalUntilAge: p.renewalUntilAge == null ? "" : String(p.renewalUntilAge),
      annualLimit: p.annualLimit == null ? "" : String(p.annualLimit),
      beneficiary: p.beneficiary || "",
      keyClauses: p.keyClauses || "",
      keyExclusions: p.keyExclusions || "",
      reviewedAt: p.reviewedAt || "",
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

  const copyExtractionPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildInsuranceExtractionPrompt(members.filter((member) => member.isActive).map((member) => member.name)));
      setExtractionMessage("提取提示词已复制。请在可读取保单文件的 AI 中粘贴并上传文件。 ");
    } catch {
      setExtractionMessage("浏览器未允许自动复制，请展开下方提示词后手工复制。");
    }
  };

  const applyExtraction = () => {
    setError("");
    try {
      const value = parseInsuranceExtraction(extractionText);
      const insured = value.insuredMemberName
        ? members.find((member) => member.name.trim() === value.insuredMemberName?.trim())
        : undefined;
      const policyholder = value.policyholderMemberName
        ? members.find((member) => member.name.trim() === value.policyholderMemberName?.trim())
        : undefined;
      setForm((current) => ({
        ...current,
        name: value.name ?? current.name,
        category: value.category ?? current.category,
        insuredMemberId: insured?.id ?? current.insuredMemberId,
        policyholderMemberId: policyholder?.id ?? current.policyholderMemberId,
        policyNumber: value.policyNumber ?? current.policyNumber,
        insurer: value.insurer ?? current.insurer,
        coverageAmount: value.coverageAmount === undefined ? current.coverageAmount : String(value.coverageAmount),
        premium: value.premium === undefined ? current.premium : String(value.premium),
        premiumFrequency: value.premiumFrequency ?? current.premiumFrequency,
        cashValue: value.cashValue === undefined ? current.cashValue : String(value.cashValue),
        startDate: value.startDate ?? current.startDate,
        endDate: value.endDate ?? current.endDate,
        coverageSummary: value.coverageSummary ?? current.coverageSummary,
        coverageTerm: value.coverageTerm ?? current.coverageTerm,
        deductible: value.deductible === undefined ? current.deductible : String(value.deductible),
        reimbursementRatio: value.reimbursementRatio === undefined ? current.reimbursementRatio : String(value.reimbursementRatio),
        waitingPeriodDays: value.waitingPeriodDays === undefined ? current.waitingPeriodDays : String(value.waitingPeriodDays),
        renewalType: value.renewalType ?? current.renewalType,
        renewalUntilAge: value.renewalUntilAge === undefined ? current.renewalUntilAge : String(value.renewalUntilAge),
        annualLimit: value.annualLimit === undefined ? current.annualLimit : String(value.annualLimit),
        beneficiary: value.beneficiary ?? current.beneficiary,
        keyClauses: value.keyClauses ?? current.keyClauses,
        keyExclusions: value.keyExclusions ?? current.keyExclusions,
        claimPhone: value.claimPhone ?? current.claimPhone,
        claimChannels: value.claimChannels ?? current.claimChannels,
        claimSteps: value.claimSteps ?? current.claimSteps,
        claimMaterials: value.claimMaterials ?? current.claimMaterials,
        claimNotes: value.claimNotes ?? current.claimNotes,
      }));
      const unmatched = [
        value.insuredMemberName && !insured ? `被保人“${value.insuredMemberName}”` : null,
        value.policyholderMemberName && !policyholder ? `投保人“${value.policyholderMemberName}”` : null,
      ].filter(Boolean);
      setExtractionMessage(`已将识别结果填入表单，请逐项核对后再保存。${unmatched.length ? ` 未自动匹配：${unmatched.join("、")}。` : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法解析提取结果");
    }
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

      {readiness && <ReadinessCard value={readiness} />}

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
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-lg bg-card p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-bold">{editingId ? "编辑保单" : "新增保单"}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
              <details className="rounded border border-blue-200 bg-blue-50 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-blue-900">用 AI 从电子保单提取信息（可选）</summary>
                <p className="mt-2 text-xs text-blue-800">系统不会把保单上传给大模型。你可以复制提示词，在自己选择的文件识别 AI 中读取保单，再把其 JSON 回答粘贴回来。保单可能含身份证号、地址等敏感信息，请只使用可信服务并按需遮盖无关信息。</p>
                <button type="button" onClick={copyExtractionPrompt} className="mt-3 flex items-center gap-1 rounded border border-blue-300 bg-white px-3 py-2 text-xs text-blue-800"><Copy className="h-3.5 w-3.5" />复制提取提示词</button>
                <details className="mt-3 rounded bg-white p-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">无法自动复制时，点此查看完整提示词</summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-sans">{buildInsuranceExtractionPrompt(members.filter((member) => member.isActive).map((member) => member.name))}</pre>
                </details>
                <textarea rows={5} value={extractionText} onChange={(e) => setExtractionText(e.target.value)} placeholder="将 AI 返回的 JSON 粘贴到这里" className="mt-3 w-full rounded border bg-white px-3 py-2 text-xs" />
                <button type="button" disabled={!extractionText.trim()} onClick={applyExtraction} className="mt-2 flex items-center gap-1 rounded bg-blue-700 px-3 py-2 text-xs text-white disabled:opacity-50"><ClipboardPaste className="h-3.5 w-3.5" />解析并填入表单</button>
                {extractionMessage && <p className="mt-2 text-xs text-blue-800">{extractionMessage}</p>}
              </details>
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
              <div className="rounded border p-3">
                <p className="mb-1 text-sm font-medium">保障与关键条款（均可选）</p>
                <p className="mb-3 text-xs text-muted-foreground">用于后续保障诊断。未填写的字段只会标记为资料缺失，不会被当作“没有保障”。</p>
                <div className="space-y-2">
                  <textarea rows={3} placeholder="主要保障责任摘要" value={form.coverageSummary} onChange={(e) => setForm({ ...form, coverageSummary: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <div className="flex gap-2">
                    <input type="text" placeholder="保障期限，如终身、至70岁" value={form.coverageTerm} onChange={(e) => setForm({ ...form, coverageTerm: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm" />
                    <input type="text" placeholder="受益人" value={form.beneficiary} onChange={(e) => setForm({ ...form, beneficiary: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" min="0" step="0.01" placeholder="免赔额（元）" value={form.deductible} onChange={(e) => setForm({ ...form, deductible: e.target.value })} className="rounded border px-3 py-2 text-sm" />
                    <input type="number" min="0" max="100" step="0.01" placeholder="赔付比例（%）" value={form.reimbursementRatio} onChange={(e) => setForm({ ...form, reimbursementRatio: e.target.value })} className="rounded border px-3 py-2 text-sm" />
                    <input type="number" min="0" max="3650" step="1" placeholder="等待期（天）" value={form.waitingPeriodDays} onChange={(e) => setForm({ ...form, waitingPeriodDays: e.target.value })} className="rounded border px-3 py-2 text-sm" />
                    <input type="number" min="0" step="0.01" placeholder="年度赔付限额（元）" value={form.annualLimit} onChange={(e) => setForm({ ...form, annualLimit: e.target.value })} className="rounded border px-3 py-2 text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <select value={form.renewalType} onChange={(e) => setForm({ ...form, renewalType: e.target.value as InsuranceRenewalType | "" })} className="flex-1 rounded border px-3 py-2 text-sm">
                      <option value="">续保条件（未配置）</option>
                      {(Object.keys(RENEWAL_LABELS) as InsuranceRenewalType[]).map((key) => <option key={key} value={key}>{RENEWAL_LABELS[key]}</option>)}
                    </select>
                    <input type="number" min="0" max="150" step="1" placeholder="最高可续保年龄" value={form.renewalUntilAge} onChange={(e) => setForm({ ...form, renewalUntilAge: e.target.value })} className="flex-1 rounded border px-3 py-2 text-sm" />
                  </div>
                  <textarea rows={3} placeholder="重要条款、给付条件或限制" value={form.keyClauses} onChange={(e) => setForm({ ...form, keyClauses: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <textarea rows={3} placeholder="责任免除与不保事项" value={form.keyExclusions} onChange={(e) => setForm({ ...form, keyExclusions: e.target.value })} className="w-full rounded border px-3 py-2 text-sm" />
                  <label className="block text-xs text-muted-foreground">资料核对日期（确认上述内容与保单一致后填写）<input type="date" max={new Date().toISOString().slice(0, 10)} value={form.reviewedAt} onChange={(e) => setForm({ ...form, reviewedAt: e.target.value })} className="mt-1 w-full rounded border px-3 py-2 text-sm" /></label>
                </div>
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
              <Info label="保障期限" value={detail.coverageTerm || `${detail.startDate || "未填写"} ~ ${detail.endDate || "未填写"}`} />
              <Info label="保额" value={detail.coverageAmount == null ? "未填写" : formatCurrency(detail.coverageAmount)} />
              <Info label="免赔额" value={detail.deductible == null ? "未填写" : formatCurrency(detail.deductible)} />
              <Info label="赔付比例" value={detail.reimbursementRatio == null ? "未填写" : `${detail.reimbursementRatio}%`} />
              <Info label="等待期" value={detail.waitingPeriodDays == null ? "未填写" : `${detail.waitingPeriodDays}天`} />
              <Info label="续保条件" value={detail.renewalType ? RENEWAL_LABELS[detail.renewalType] : "未填写"} />
              <Info label="最高可续保年龄" value={detail.renewalUntilAge == null ? "未填写" : `${detail.renewalUntilAge}岁`} />
              <Info label="年度赔付限额" value={detail.annualLimit == null ? "未填写" : formatCurrency(detail.annualLimit)} />
              <Info label="受益人" value={detail.beneficiary || "未填写"} />
              <Info label="资料核对日期" value={detail.reviewedAt || "未核对"} />
              <Info label="理赔电话" value={detail.claimPhone || "未填写"} />
              <Info label="理赔联系人" value={[detail.claimContact, detail.claimContactPhone].filter(Boolean).join(" ") || "未填写"} />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <TextBlock title="主要保障责任" value={detail.coverageSummary} />
              <TextBlock title="重要条款" value={detail.keyClauses} />
              <TextBlock title="责任免除" value={detail.keyExclusions} />
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

function ReadinessCard({ value }: { value: InsuranceReadiness }) {
  const issueCount = value.members.reduce(
    (sum, member) => sum + member.profileMissing.length + member.policyMissing.length + (member.policyCount === 0 ? 1 : 0),
    value.unassignedPolicyCount
  );
  return <div className={`rounded-lg border p-4 ${issueCount === 0 ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
    <div className="flex items-start gap-2">
      {issueCount === 0 ? <CircleCheck className="mt-0.5 h-5 w-5 text-green-700" /> : <CircleAlert className="mt-0.5 h-5 w-5 text-amber-700" />}
      <div className="min-w-0 flex-1">
        <p className="font-medium">保障诊断资料准备度</p>
        <p className="mt-1 text-xs text-muted-foreground">这里只检查后续分析所需资料是否齐全，不判断保障是否充足。缺少资料不会影响保单保存和日常使用。</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {value.members.map((member) => {
            const policyFields = [...new Set(member.policyMissing.map((item) => item.field))];
            return <div key={member.memberId} className="rounded border bg-white/80 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><strong>{member.memberName}</strong><span className="text-xs text-muted-foreground">{member.policyCount} 张生效保单</span></div>
              <p className="mt-2 text-xs text-muted-foreground">已记录险种：{member.categories.length ? member.categories.map((key) => INSURANCE_CATEGORY_LABELS[key]).join("、") : "暂无"}</p>
              {member.profileMissing.length > 0 && <p className="mt-1 text-xs text-amber-800">成员资料待补：{member.profileMissing.join("、")}</p>}
              {member.policyCount === 0 && <p className="mt-1 text-xs text-amber-800">尚无归属于该成员的生效保单</p>}
              {policyFields.length > 0 && <p className="mt-1 text-xs text-amber-800">保单资料待补：{policyFields.join("、")}</p>}
              {member.profileMissing.length === 0 && member.policyCount > 0 && policyFields.length === 0 && <p className="mt-1 text-xs text-green-700">基础资料已齐备</p>}
            </div>;
          })}
        </div>
        {value.members.length === 0 && <p className="mt-3 text-sm text-amber-800">暂无生效中的家庭成员，请先在成员管理中维护。</p>}
        {value.unassignedPolicyCount > 0 && <p className="mt-2 text-xs text-amber-800">另有 {value.unassignedPolicyCount} 张生效保单尚未选择被保人，后续无法按家庭成员分析。</p>}
      </div>
    </div>
  </div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}

function TextBlock({ title, value }: { title: string; value: string | null }) {
  return <div className="rounded border p-3"><p className="text-sm font-medium">{title}</p><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{value || "未填写"}</p></div>;
}
