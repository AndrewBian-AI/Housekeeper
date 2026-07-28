import { db } from "../db/connection.js";
import { assets, members } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { normalizeDateString } from "../utils/date.js";

export const ASSET_TYPES = ["cash", "fixed_income", "equity", "real_estate", "physical", "pension", "receivable", "other"] as const;
export const ALLOCATION_BUCKETS = ["liquid", "stable", "growth", "protection"] as const;
export const LIABILITY_TYPES = ["mortgage", "car_loan", "credit_card", "consumer_loan", "other"] as const;
export const INSURANCE_CATEGORIES = ["social", "medical", "life", "pension", "property", "accident", "other"] as const;
export const PREMIUM_FREQUENCIES = ["monthly", "quarterly", "yearly", "one-time"] as const;

export function validateRequiredName(value: unknown, label = "名称"): string | null {
  return typeof value === "string" && value.trim() ? null : `${label}不能为空`;
}

export function validateEnum(value: unknown, allowed: readonly string[], label: string): string | null {
  return typeof value === "string" && allowed.includes(value) ? null : `${label}无效`;
}

export function validateNonNegative(value: unknown, label: string, required = false): string | null {
  if (value === undefined || value === null || value === "") {
    return required ? `${label}不能为空` : null;
  }
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? null : `${label}必须是大于或等于0的数字`;
}

export function validateMember(memberId: unknown, label = "所属成员"): string | null {
  if (memberId === undefined || memberId === null || memberId === "") return null;
  if (typeof memberId !== "string") return `${label}无效`;
  return db.select({ id: members.id }).from(members).where(eq(members.id, memberId)).get() ? null : `${label}不存在`;
}

export function validateLinkedAsset(assetId: unknown): string | null {
  if (assetId === undefined || assetId === null || assetId === "") return null;
  if (typeof assetId !== "string") return "关联资产无效";
  return db.select({ id: assets.id }).from(assets).where(eq(assets.id, assetId)).get() ? null : "关联资产不存在";
}

export function validateDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && normalizeDateString(value) === value ? null : `${label}格式无效`;
}

export function firstError(...errors: Array<string | null>): string | null {
  return errors.find((error): error is string => Boolean(error)) ?? null;
}
