import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/connection.js";
import { annualProjects, pendingProjectConfirmations, transactions } from "../db/schema.js";

const now = () => new Date().toISOString();

function projectsByIds(ids: string[]) {
  return ids
    .map((id) => db.select().from(annualProjects).where(eq(annualProjects.id, id)).get())
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

export function createProjectConfirmation(
  installationId: string,
  senderId: string,
  transactionId: string,
  candidateProjectIds: string[]
): string | null {
  const projects = projectsByIds(candidateProjectIds);
  if (!projects.length) return null;
  const timestamp = now();
  const oldPending = db
    .select()
    .from(pendingProjectConfirmations)
    .where(
      and(
        eq(pendingProjectConfirmations.installationId, installationId),
        eq(pendingProjectConfirmations.senderId, senderId),
        eq(pendingProjectConfirmations.status, "pending")
      )
    )
    .all();
  for (const item of oldPending) {
    db.update(pendingProjectConfirmations)
      .set({ status: "superseded", updatedAt: timestamp })
      .where(eq(pendingProjectConfirmations.id, item.id))
      .run();
  }
  db.insert(pendingProjectConfirmations)
    .values({
      id: nanoid(),
      installationId,
      senderId,
      transactionId,
      candidateProjectIds: JSON.stringify(projects.map((item) => item.id)),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  if (projects.length === 1) {
    return `AI 判断这笔支出可能属于年度专项【${projects[0].name}】，是否关联？\n请回复“确认专项”或“不关联”（30分钟内有效）。`;
  }
  return `这笔支出可能属于以下年度专项：${projects
    .map((item) => `【${item.name}】`)
    .join("、")}\n请回复专项名称，或回复“不关联”（30分钟内有效）。`;
}

/** 只消费明确的确认回复，普通消息返回 null 并继续正常记账。 */
export function handleProjectConfirmationReply(
  installationId: string,
  senderId: string,
  message: string
): string | null {
  const pending = db
    .select()
    .from(pendingProjectConfirmations)
    .where(
      and(
        eq(pendingProjectConfirmations.installationId, installationId),
        eq(pendingProjectConfirmations.senderId, senderId),
        eq(pendingProjectConfirmations.status, "pending")
      )
    )
    .orderBy(desc(pendingProjectConfirmations.createdAt))
    .get();
  if (!pending) return null;

  let ids: string[] = [];
  try {
    ids = JSON.parse(pending.candidateProjectIds) as string[];
  } catch {
    ids = [];
  }
  const projects = projectsByIds(ids);
  const text = message.trim();
  const rejected = ["不关联", "取消专项", "否"].includes(text);
  const selected =
    projects.length === 1 && ["确认专项", "确认", "是"].includes(text)
      ? projects[0]
      : projects.find((item) => item.name === text);
  if (!rejected && !selected) return null;

  const timestamp = now();
  if (pending.expiresAt < timestamp) {
    db.update(pendingProjectConfirmations)
      .set({ status: "expired", updatedAt: timestamp })
      .where(eq(pendingProjectConfirmations.id, pending.id))
      .run();
    return "年度专项确认已超过30分钟，请在管理后台为这笔支出补充专项归属。";
  }
  if (selected) {
    db.update(transactions)
      .set({ annualProjectId: selected.id, updatedAt: timestamp })
      .where(eq(transactions.id, pending.transactionId))
      .run();
  }
  db.update(pendingProjectConfirmations)
    .set({ status: selected ? "confirmed" : "rejected", updatedAt: timestamp })
    .where(eq(pendingProjectConfirmations.id, pending.id))
    .run();
  return selected
    ? `已将这笔支出归入年度专项【${selected.name}】。`
    : "好的，这笔支出保持为普通日常支出。";
}
