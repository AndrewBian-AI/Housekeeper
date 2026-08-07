import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/api/client";
import type { MemberIncomeRole, MemberRelationship, MemberWithUsage } from "@caiwu/shared";
import {
  Archive,
  Edit2,
  Link2,
  Merge,
  RotateCcw,
  Trash2,
  Unlink,
  UserPlus,
  UserRoundCog,
} from "lucide-react";

const ROLE_LABELS: Record<string, string> = { admin: "管理员", member: "成员" };
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
const emptyProfileForm = {
  relationship: "" as MemberRelationship | "",
  birthDate: "",
  incomeRole: "" as MemberIncomeRole | "",
  financialDependency: "unknown" as "unknown" | "yes" | "no",
};

function profileSummary(member: MemberWithUsage) {
  const values = [
    member.relationship ? RELATIONSHIP_LABELS[member.relationship] : null,
    member.birthDate || null,
    member.incomeRole ? INCOME_ROLE_LABELS[member.incomeRole] : null,
    member.isFinancialDependent === true ? "经济依赖家庭" : member.isFinancialDependent === false ? "经济独立" : null,
  ].filter(Boolean);
  return values.length ? values.join(" · ") : "尚未配置";
}

function usageTotal(member: MemberWithUsage) {
  return Object.values(member.usage).reduce((sum, count) => sum + count, 0);
}

function usageText(member: MemberWithUsage) {
  const parts = [
    ["记账", member.usage.transactions],
    ["资产", member.usage.assets],
    ["负债", member.usage.liabilities],
    ["保单", member.usage.policies],
    ["体检", member.usage.checkups],
    ["就诊", member.usage.visits],
  ].filter(([, count]) => Number(count) > 0);
  return parts.length ? parts.map(([label, count]) => `${label}${count}`).join("、") : "暂无业务数据";
}

export function MembersPage() {
  const [members, setMembers] = useState<MemberWithUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "archived">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", role: "member" });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", role: "member", ...emptyProfileForm });
  const [saving, setSaving] = useState(false);
  const [mergeSource, setMergeSource] = useState<MemberWithUsage | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [bindingMember, setBindingMember] = useState<MemberWithUsage | null>(null);
  const [wechatUserId, setWechatUserId] = useState("");
  const [profileMember, setProfileMember] = useState<MemberWithUsage | null>(null);
  const [profileForm, setProfileForm] = useState(emptyProfileForm);

  useEffect(() => { void loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      setMembers(await api.get<MemberWithUsage[]>("/members"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载成员失败");
    } finally {
      setLoading(false);
    }
  };

  const visibleMembers = useMemo(
    () => members.filter((member) => filter === "all" || (filter === "active" ? member.isActive : !member.isActive)),
    [members, filter]
  );
  const mergeTargets = members.filter(
    (member) => member.isActive && !member.mergedIntoMemberId && member.id !== mergeSource?.id
  );

  const run = async (action: () => Promise<unknown>) => {
    setSaving(true);
    setError("");
    try {
      await action();
      await loadData();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (member: MemberWithUsage) => {
    setEditingId(member.id);
    setForm({ name: member.name, role: member.role });
  };

  const handleSave = async () => {
    if (!editingId || !form.name.trim()) return;
    if (await run(() => api.put(`/members/${editingId}`, form))) setEditingId(null);
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    const body = {
      name: createForm.name,
      role: createForm.role,
      relationship: createForm.relationship || null,
      birthDate: createForm.birthDate || null,
      incomeRole: createForm.incomeRole || null,
      isFinancialDependent:
        createForm.financialDependency === "unknown"
          ? null
          : createForm.financialDependency === "yes",
    };
    if (await run(() => api.post("/members", body))) {
      setShowCreate(false);
      setCreateForm({ name: "", role: "member", ...emptyProfileForm });
    }
  };

  const changeStatus = async (member: MemberWithUsage) => {
    const action = member.isActive ? "归档" : "恢复";
    const warning = member.wechatUserId && member.isActive
      ? "\n归档后，该微信将暂停记账和查询，恢复成员后才可继续使用。"
      : "";
    if (!confirm(`确定${action}成员“${member.name}”吗？${warning}`)) return;
    await run(() => api.put(`/members/${member.id}/status`, { isActive: !member.isActive }));
  };

  const deleteMember = async (member: MemberWithUsage) => {
    if (!confirm(`确定永久删除空成员“${member.name}”吗？此操作不能撤销。`)) return;
    await run(() => api.delete(`/members/${member.id}`));
  };

  const openMerge = (member: MemberWithUsage) => {
    setMergeSource(member);
    setMergeTargetId(members.find((item) => item.isActive && !item.mergedIntoMemberId && item.id !== member.id)?.id || "");
  };

  const submitMerge = async () => {
    if (!mergeSource || !mergeTargetId) return;
    const target = members.find((member) => member.id === mergeTargetId);
    if (!confirm(`确认将“${mergeSource.name}”合并到“${target?.name}”吗？\n${usageText(mergeSource)}及微信绑定会转移，来源成员将保留为已合并记录。`)) return;
    if (await run(() => api.post("/members/merge", { sourceMemberId: mergeSource.id, targetMemberId: mergeTargetId }))) {
      setMergeSource(null);
      setMergeTargetId("");
    }
  };

  const openBinding = (member: MemberWithUsage) => {
    setBindingMember(member);
    setWechatUserId(member.wechatUserId || "");
  };

  const saveBinding = async () => {
    if (!bindingMember) return;
    if (await run(() => api.put(`/members/${bindingMember.id}/wechat-binding`, { wechatUserId: wechatUserId.trim() || null }))) {
      setBindingMember(null);
      setWechatUserId("");
    }
  };

  const openProfile = (member: MemberWithUsage) => {
    setProfileMember(member);
    setProfileForm({
      relationship: member.relationship || "",
      birthDate: member.birthDate || "",
      incomeRole: member.incomeRole || "",
      financialDependency:
        member.isFinancialDependent === null ? "unknown" : member.isFinancialDependent ? "yes" : "no",
    });
  };

  const saveProfile = async () => {
    if (!profileMember) return;
    const body = {
      relationship: profileForm.relationship || null,
      birthDate: profileForm.birthDate || null,
      incomeRole: profileForm.incomeRole || null,
      isFinancialDependent:
        profileForm.financialDependency === "unknown"
          ? null
          : profileForm.financialDependency === "yes",
    };
    if (await run(() => api.put(`/members/${profileMember.id}`, body))) setProfileMember(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">成员管理</h2>
          <p className="text-sm text-muted-foreground">维护家庭成员身份、微信绑定及历史数据归属。</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          <UserPlus className="h-4 w-4" /> 新增成员
        </button>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-medium">登录账号、家庭成员、微信身份是三套不同信息</p>
        <p className="mt-1 text-blue-800">这里的“管理员/成员”用于家庭业务归属，不会改变系统登录密码。微信首次记账可能自动生成成员；若与现有成员是同一个人，请使用“合并”。</p>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2">
        {(["all", "active", "archived"] as const).map((value) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`rounded-md border px-3 py-1.5 text-sm ${filter === value ? "bg-primary text-primary-foreground" : "bg-card"}`}
          >
            {value === "all" ? "全部" : value === "active" ? "生效中" : "已归档"}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1160px] text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left">名称</th>
              <th className="px-4 py-3 text-left">角色</th>
              <th className="px-4 py-3 text-left">状态</th>
              <th className="px-4 py-3 text-left">微信</th>
              <th className="px-4 py-3 text-left">家庭基础资料</th>
              <th className="px-4 py-3 text-left">关联数据</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">加载中...</td></tr>
              ) : visibleMembers.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">暂无成员</td></tr>
              ) : visibleMembers.map((member) => {
                const canDelete = usageTotal(member) === 0 && !member.wechatUserId && !member.mergedIntoMemberId;
                return (
                  <tr key={member.id} className={`border-b last:border-0 hover:bg-muted/30 ${member.isActive ? "" : "opacity-70"}`}>
                    <td className="px-4 py-3">
                      {editingId === member.id ? (
                        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-36 rounded border px-2 py-1 text-sm" />
                      ) : <span className="font-medium">{member.name}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === member.id ? (
                        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className="rounded border px-2 py-1 text-sm">
                          <option value="admin">管理员</option><option value="member">成员</option>
                        </select>
                      ) : <span className={`rounded px-2 py-0.5 text-xs ${member.role === "admin" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}>{ROLE_LABELS[member.role]}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {member.mergedIntoMemberId ? (
                        <span className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-700">已合并至 {member.mergedIntoMemberName || "其他成员"}</span>
                      ) : <span className={`rounded px-2 py-0.5 text-xs ${member.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{member.isActive ? "生效中" : "已归档"}</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{member.wechatUserId ? "已绑定" : "未绑定"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{profileSummary(member)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{usageText(member)}</td>
                    <td className="px-4 py-3">
                      {editingId === member.id ? (
                        <div className="flex justify-end gap-1">
                          <button onClick={handleSave} disabled={saving} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">保存</button>
                          <button onClick={() => setEditingId(null)} className="rounded border px-2 py-1 text-xs">取消</button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-1">
                          {!member.mergedIntoMemberId && <button onClick={() => handleEdit(member)} className="flex items-center gap-1 rounded border px-2 py-1 text-xs" title="编辑"><Edit2 className="h-3.5 w-3.5" /> 编辑</button>}
                          {!member.mergedIntoMemberId && <button onClick={() => openProfile(member)} className="flex items-center gap-1 rounded border px-2 py-1 text-xs" title="配置保障诊断所需的家庭基础资料"><UserRoundCog className="h-3.5 w-3.5" /> 资料</button>}
                          {!member.mergedIntoMemberId && member.isActive && <button onClick={() => openBinding(member)} className="flex items-center gap-1 rounded border px-2 py-1 text-xs" title={member.wechatUserId ? "管理微信绑定" : "绑定微信"}>{member.wechatUserId ? <Unlink className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />} 微信</button>}
                          {!member.mergedIntoMemberId && <button onClick={() => openMerge(member)} className="flex items-center gap-1 rounded border px-2 py-1 text-xs" title="合并成员"><Merge className="h-3.5 w-3.5" /> 合并</button>}
                          {!member.mergedIntoMemberId && <button onClick={() => changeStatus(member)} className="flex items-center gap-1 rounded border px-2 py-1 text-xs" title={member.isActive ? "归档" : "恢复"}>{member.isActive ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}{member.isActive ? "归档" : "恢复"}</button>}
                          {canDelete && <button onClick={() => deleteMember(member)} className="flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-600" title="永久删除空成员"><Trash2 className="h-3.5 w-3.5" /> 删除</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <Modal title="新增成员" onClose={() => setShowCreate(false)}>
          <Field label="名称 *"><input value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="如：家庭成员姓名" className="w-full rounded-md border px-3 py-2 text-sm" /></Field>
          <Field label="角色"><select value={createForm.role} onChange={(event) => setCreateForm({ ...createForm, role: event.target.value })} className="w-full rounded-md border px-3 py-2 text-sm"><option value="member">成员</option><option value="admin">管理员</option></select></Field>
          <ProfileFields value={createForm} onChange={setCreateForm} />
          <p className="text-xs text-muted-foreground">手动新增的成员默认没有微信绑定，可用于记账、资产、保险和健康档案归属。</p>
          <ModalActions onCancel={() => setShowCreate(false)} onConfirm={handleCreate} saving={saving} />
        </Modal>
      )}

      {mergeSource && (
        <Modal title="合并重复成员" onClose={() => setMergeSource(null)}>
          <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            来源成员：<strong>{mergeSource.name}</strong><br />
            将转移：{usageText(mergeSource)}{mergeSource.wechatUserId ? "、微信绑定" : ""}
          </div>
          <Field label="保留成员 *"><select value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} className="w-full rounded-md border px-3 py-2 text-sm"><option value="">请选择</option>{mergeTargets.map((member) => <option key={member.id} value={member.id}>{member.name}{member.wechatUserId ? "（已绑定微信）" : ""}</option>)}</select></Field>
          <p className="text-xs text-muted-foreground">合并后，来源成员会标记为“已合并”，不能单独恢复；业务数据与微信绑定归入保留成员。</p>
          <ModalActions onCancel={() => setMergeSource(null)} onConfirm={submitMerge} saving={saving} confirmLabel="确认合并" />
        </Modal>
      )}

      {bindingMember && (
        <Modal title="管理微信绑定" onClose={() => setBindingMember(null)}>
          <p className="text-sm text-muted-foreground">成员：{bindingMember.name}</p>
          <Field label="微信身份 ID"><input value={wechatUserId} onChange={(event) => setWechatUserId(event.target.value)} placeholder="留空并保存即解绑" className="w-full rounded-md border px-3 py-2 text-sm" /></Field>
          <p className="text-xs text-muted-foreground">通常无需手工填写。如果微信已自动生成另一个成员，请关闭此窗口并使用“合并成员”，系统会自动转移绑定。</p>
          <ModalActions onCancel={() => setBindingMember(null)} onConfirm={saveBinding} saving={saving} confirmLabel={wechatUserId.trim() ? "保存绑定" : "确认解绑"} />
        </Modal>
      )}

      {profileMember && (
        <Modal title={`家庭基础资料：${profileMember.name}`} onClose={() => setProfileMember(null)}>
          <div className="rounded-md bg-blue-50 p-3 text-xs text-blue-800">
            这些资料用于后续按家庭成员评估保障覆盖。全部为非必填；未配置时系统只会提示资料不足，不会推断保障不足。
          </div>
          <ProfileFields value={profileForm} onChange={setProfileForm} />
          <ModalActions onCancel={() => setProfileMember(null)} onConfirm={saveProfile} saving={saving} />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md space-y-4 rounded-lg bg-card p-5 shadow-xl"><h3 className="text-lg font-bold">{title}</h3>{children}</div></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><label className="mb-1 block text-sm text-muted-foreground">{label}</label>{children}</div>;
}

function ProfileFields<T extends typeof emptyProfileForm>({ value, onChange }: { value: T; onChange: (value: T) => void }) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <Field label="与本人的关系（可选）">
      <select value={value.relationship} onChange={(event) => onChange({ ...value, relationship: event.target.value as MemberRelationship | "" })} className="w-full rounded-md border px-3 py-2 text-sm">
        <option value="">未配置</option>
        {(Object.keys(RELATIONSHIP_LABELS) as MemberRelationship[]).map((key) => <option key={key} value={key}>{RELATIONSHIP_LABELS[key]}</option>)}
      </select>
    </Field>
    <Field label="出生日期（可选）"><input type="date" max={new Date().toISOString().slice(0, 10)} value={value.birthDate} onChange={(event) => onChange({ ...value, birthDate: event.target.value })} className="w-full rounded-md border px-3 py-2 text-sm" /></Field>
    <Field label="家庭收入角色（可选）">
      <select value={value.incomeRole} onChange={(event) => onChange({ ...value, incomeRole: event.target.value as MemberIncomeRole | "" })} className="w-full rounded-md border px-3 py-2 text-sm">
        <option value="">未配置</option>
        {(Object.keys(INCOME_ROLE_LABELS) as MemberIncomeRole[]).map((key) => <option key={key} value={key}>{INCOME_ROLE_LABELS[key]}</option>)}
      </select>
    </Field>
    <Field label="经济上依赖家庭（可选）">
      <select value={value.financialDependency} onChange={(event) => onChange({ ...value, financialDependency: event.target.value as "unknown" | "yes" | "no" })} className="w-full rounded-md border px-3 py-2 text-sm">
        <option value="unknown">未配置</option><option value="yes">是</option><option value="no">否</option>
      </select>
    </Field>
  </div>;
}

function ModalActions({ onCancel, onConfirm, saving, confirmLabel = "保存" }: { onCancel: () => void; onConfirm: () => void; saving: boolean; confirmLabel?: string }) {
  return <div className="flex justify-end gap-2"><button onClick={onCancel} className="rounded-md border px-3 py-2 text-sm" disabled={saving}>取消</button><button onClick={onConfirm} disabled={saving} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{saving ? "处理中..." : confirmLabel}</button></div>;
}
