import type { Member } from "@caiwu/shared";

/** 新业务只允许选择生效成员；编辑历史数据时保留当前已归档成员供原值展示。 */
export function selectableMembers(members: Member[], ...selectedIds: Array<string | null | undefined>) {
  const selected = new Set(selectedIds.filter((id): id is string => Boolean(id)));
  return members.filter((member) => member.isActive || selected.has(member.id));
}

export function memberOptionLabel(member: Member) {
  return `${member.name}${member.isActive ? "" : "（已归档）"}`;
}
