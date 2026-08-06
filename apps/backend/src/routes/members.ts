import type { FastifyInstance } from "fastify";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, sqlite } from "../db/connection.js";
import {
  assets,
  healthCheckups,
  insurancePolicies,
  liabilities,
  medicalVisits,
  members,
  transactions,
} from "../db/schema.js";
import { authGuard } from "../middleware/auth.js";

type MemberTableName = "transactions" | "assets" | "liabilities" | "health_checkups" | "medical_visits";

function countRows(tableName: MemberTableName, memberId: string) {
  const row = sqlite
    .prepare(`SELECT count(*) AS count FROM ${tableName} WHERE member_id = ?`)
    .get(memberId) as { count: number } | undefined;
  return Number(row?.count || 0);
}

function getMemberUsage(memberId: string) {
  const policies = db
    .select({ count: sql<number>`count(*)` })
    .from(insurancePolicies)
    .where(
      or(
        eq(insurancePolicies.insuredMemberId, memberId),
        eq(insurancePolicies.policyholderMemberId, memberId)
      )
    )
    .get();
  return {
    transactions: countRows("transactions", memberId),
    assets: countRows("assets", memberId),
    liabilities: countRows("liabilities", memberId),
    policies: Number(policies?.count || 0),
    checkups: countRows("health_checkups", memberId),
    visits: countRows("medical_visits", memberId),
  };
}

function enrichMember(member: typeof members.$inferSelect) {
  const mergedInto = member.mergedIntoMemberId
    ? db.select({ name: members.name }).from(members).where(eq(members.id, member.mergedIntoMemberId)).get()
    : null;
  return {
    ...member,
    mergedIntoMemberName: mergedInto?.name || null,
    usage: getMemberUsage(member.id),
  };
}

function validRole(role: unknown): role is "admin" | "member" {
  return role === "admin" || role === "member";
}

export async function memberRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.get<{ Querystring: { active?: string } }>("/", async (request) => {
    const rows = request.query.active === "true"
      ? db.select().from(members).where(eq(members.isActive, true)).all()
      : db.select().from(members).all();
    return rows.map(enrichMember);
  });

  // 手动新增成员（用于尚未绑定微信的家庭成员）。
  app.post<{ Body: { name?: string; role?: string } }>("/", async (request, reply) => {
    const name = request.body.name?.trim();
    if (!name) return reply.status(400).send({ error: "成员名称不能为空" });
    if (request.body.role !== undefined && !validRole(request.body.role)) {
      return reply.status(400).send({ error: "成员角色无效" });
    }
    const id = nanoid();
    const ts = new Date().toISOString();
    db.insert(members)
      .values({
        id,
        wechatUserId: null,
        name,
        role: request.body.role === "admin" ? "admin" : "member",
        isActive: true,
        mergedIntoMemberId: null,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    return enrichMember(db.select().from(members).where(eq(members.id, id)).get()!);
  });

  app.post<{ Body: { sourceMemberId?: string; targetMemberId?: string } }>(
    "/merge",
    async (request, reply) => {
      const { sourceMemberId, targetMemberId } = request.body;
      if (!sourceMemberId || !targetMemberId || sourceMemberId === targetMemberId) {
        return reply.status(400).send({ error: "请选择两个不同的来源成员和保留成员" });
      }
      const source = db.select().from(members).where(eq(members.id, sourceMemberId)).get();
      const target = db.select().from(members).where(eq(members.id, targetMemberId)).get();
      if (!source || !target) return reply.status(404).send({ error: "成员不存在" });
      if (source.mergedIntoMemberId) return reply.status(400).send({ error: "来源成员已经合并过" });
      if (!target.isActive || target.mergedIntoMemberId) {
        return reply.status(400).send({ error: "保留成员必须是生效中的独立成员" });
      }
      if (
        source.wechatUserId &&
        target.wechatUserId &&
        source.wechatUserId !== target.wechatUserId
      ) {
        return reply.status(409).send({ error: "两个成员分别绑定了不同微信，请先解绑其中一个" });
      }

      const now = new Date().toISOString();
      const targetWechatUserId = target.wechatUserId || source.wechatUserId || null;
      const targetRole = source.role === "admin" || target.role === "admin" ? "admin" : "member";

      const merge = sqlite.transaction(() => {
        // 先释放来源成员的微信唯一绑定，再转移到保留成员。
        db.update(members)
          .set({ wechatUserId: null, updatedAt: now })
          .where(eq(members.id, source.id))
          .run();
        db.update(transactions).set({ memberId: target.id }).where(eq(transactions.memberId, source.id)).run();
        db.update(assets).set({ memberId: target.id, updatedAt: now }).where(eq(assets.memberId, source.id)).run();
        db.update(liabilities).set({ memberId: target.id, updatedAt: now }).where(eq(liabilities.memberId, source.id)).run();
        db.update(insurancePolicies)
          .set({ insuredMemberId: target.id, updatedAt: now })
          .where(eq(insurancePolicies.insuredMemberId, source.id))
          .run();
        db.update(insurancePolicies)
          .set({ policyholderMemberId: target.id, updatedAt: now })
          .where(eq(insurancePolicies.policyholderMemberId, source.id))
          .run();
        db.update(healthCheckups)
          .set({ memberId: target.id, updatedAt: now })
          .where(eq(healthCheckups.memberId, source.id))
          .run();
        db.update(medicalVisits)
          .set({ memberId: target.id, updatedAt: now })
          .where(eq(medicalVisits.memberId, source.id))
          .run();
        db.update(members)
          .set({
            wechatUserId: targetWechatUserId,
            role: targetRole,
            isActive: true,
            updatedAt: now,
          })
          .where(eq(members.id, target.id))
          .run();
        db.update(members)
          .set({
            isActive: false,
            mergedIntoMemberId: target.id,
            updatedAt: now,
          })
          .where(eq(members.id, source.id))
          .run();
      });
      merge();

      return {
        success: true,
        source: enrichMember(db.select().from(members).where(eq(members.id, source.id)).get()!),
        target: enrichMember(db.select().from(members).where(eq(members.id, target.id)).get()!),
      };
    }
  );

  app.put<{ Params: { id: string }; Body: { isActive?: boolean } }>(
    "/:id/status",
    async (request, reply) => {
      const existing = db.select().from(members).where(eq(members.id, request.params.id)).get();
      if (!existing) return reply.status(404).send({ error: "成员不存在" });
      if (typeof request.body.isActive !== "boolean") {
        return reply.status(400).send({ error: "成员状态无效" });
      }
      if (request.body.isActive && existing.mergedIntoMemberId) {
        return reply.status(400).send({ error: "已合并成员不能单独恢复" });
      }
      if (!request.body.isActive) {
        const otherActiveMembers = db
          .select({ id: members.id })
          .from(members)
          .where(and(eq(members.isActive, true), ne(members.id, existing.id)))
          .all();
        if (otherActiveMembers.length === 0) {
          return reply.status(400).send({ error: "至少需要保留一名生效中的家庭成员" });
        }
        if (existing.role === "admin") {
          const otherAdmins = db
            .select({ id: members.id })
            .from(members)
            .where(
              and(
                eq(members.isActive, true),
                eq(members.role, "admin"),
                ne(members.id, existing.id)
              )
            )
            .all();
          if (otherAdmins.length === 0) {
            return reply.status(400).send({ error: "请先将另一名生效成员设为管理员" });
          }
        }
      }
      db.update(members)
        .set({ isActive: request.body.isActive, updatedAt: new Date().toISOString() })
        .where(eq(members.id, existing.id))
        .run();
      return enrichMember(db.select().from(members).where(eq(members.id, existing.id)).get()!);
    }
  );

  app.put<{ Params: { id: string }; Body: { wechatUserId?: string | null } }>(
    "/:id/wechat-binding",
    async (request, reply) => {
      const existing = db.select().from(members).where(eq(members.id, request.params.id)).get();
      if (!existing) return reply.status(404).send({ error: "成员不存在" });
      if (!existing.isActive || existing.mergedIntoMemberId) {
        return reply.status(400).send({ error: "只能为生效中的独立成员设置微信绑定" });
      }
      const wechatUserId = request.body.wechatUserId?.trim() || null;
      if (wechatUserId) {
        const occupied = db
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(eq(members.wechatUserId, wechatUserId))
          .get();
        if (occupied && occupied.id !== existing.id) {
          return reply.status(409).send({ error: `该微信已绑定成员“${occupied.name}”，请使用成员合并功能` });
        }
      }
      db.update(members)
        .set({ wechatUserId, updatedAt: new Date().toISOString() })
        .where(eq(members.id, existing.id))
        .run();
      return enrichMember(db.select().from(members).where(eq(members.id, existing.id)).get()!);
    }
  );

  app.put<{ Params: { id: string }; Body: { name?: string; role?: string } }>(
    "/:id",
    async (request, reply) => {
      const existing = db.select().from(members).where(eq(members.id, request.params.id)).get();
      if (!existing) return reply.status(404).send({ error: "成员不存在" });
      if (existing.mergedIntoMemberId) return reply.status(400).send({ error: "已合并成员不能再编辑" });

      const updates: Record<string, unknown> = {};
      if (request.body.name !== undefined) {
        const name = request.body.name.trim();
        if (!name) return reply.status(400).send({ error: "成员名称不能为空" });
        updates.name = name;
      }
      if (request.body.role !== undefined) {
        if (!validRole(request.body.role)) return reply.status(400).send({ error: "成员角色无效" });
        if (existing.role === "admin" && request.body.role !== "admin" && existing.isActive) {
          const otherAdmins = db
            .select({ id: members.id })
            .from(members)
            .where(
              and(
                eq(members.isActive, true),
                eq(members.role, "admin"),
                ne(members.id, existing.id)
              )
            )
            .all();
          if (otherAdmins.length === 0) {
            return reply.status(400).send({ error: "至少需要保留一名生效中的管理员成员" });
          }
        }
        updates.role = request.body.role;
      }
      updates.updatedAt = new Date().toISOString();
      db.update(members).set(updates).where(eq(members.id, existing.id)).run();
      return enrichMember(db.select().from(members).where(eq(members.id, existing.id)).get()!);
    }
  );

  // 只允许删除从未产生任何业务数据的独立空成员。存在历史数据时应使用归档或合并。
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const existing = db.select().from(members).where(eq(members.id, request.params.id)).get();
    if (!existing) return reply.status(404).send({ error: "成员不存在" });
    if (existing.mergedIntoMemberId) {
      return reply.status(400).send({ error: "已合并成员需要保留合并记录，不能删除" });
    }
    if (existing.wechatUserId) {
      return reply.status(400).send({ error: "该成员已绑定微信，请先解绑后再删除" });
    }

    const usage = getMemberUsage(existing.id);
    const totalUsage = Object.values(usage).reduce((sum, count) => sum + count, 0);
    if (totalUsage > 0) {
      return reply.status(409).send({ error: "该成员已有业务数据，请使用归档或成员合并", usage });
    }

    const otherActiveMembers = db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.isActive, true), ne(members.id, existing.id)))
      .all();
    if (existing.isActive && otherActiveMembers.length === 0) {
      return reply.status(400).send({ error: "至少需要保留一名生效中的家庭成员" });
    }
    if (existing.isActive && existing.role === "admin") {
      const otherAdmins = db
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.isActive, true),
            eq(members.role, "admin"),
            ne(members.id, existing.id)
          )
        )
        .all();
      if (otherAdmins.length === 0) {
        return reply.status(400).send({ error: "请先将另一名生效成员设为管理员" });
      }
    }

    db.delete(members).where(eq(members.id, existing.id)).run();
    return { success: true };
  });
}
