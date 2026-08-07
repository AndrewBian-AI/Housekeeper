import type {
  AssetFrequency,
  InsuranceCategory,
  InsuranceRenewalType,
} from "@caiwu/shared";

export interface InsuranceExtractedData {
  name?: string;
  category?: InsuranceCategory;
  insuredMemberName?: string;
  policyholderMemberName?: string;
  policyNumber?: string;
  insurer?: string;
  coverageAmount?: number;
  premium?: number;
  premiumFrequency?: AssetFrequency;
  cashValue?: number;
  startDate?: string;
  endDate?: string;
  coverageSummary?: string;
  coverageTerm?: string;
  deductible?: number;
  reimbursementRatio?: number;
  waitingPeriodDays?: number;
  renewalType?: InsuranceRenewalType;
  renewalUntilAge?: number;
  annualLimit?: number;
  beneficiary?: string;
  keyClauses?: string;
  keyExclusions?: string;
  claimPhone?: string;
  claimChannels?: string;
  claimSteps?: string;
  claimMaterials?: string;
  claimNotes?: string;
}

export function buildInsuranceExtractionPrompt(memberNames: string[]) {
  return `你是一名严谨的保险保单信息整理助手。请阅读我上传的电子保单、保险条款或理赔指南，只提取文件中明确出现的信息，不要猜测，不要评价保障是否充足。

家庭成员候选名称：${memberNames.length ? memberNames.join("、") : "暂无，请保留姓名原文"}

请只返回一个合法 JSON 对象，不要使用 Markdown 代码块，不要附加解释。没有找到的字段请使用 null。金额单位统一为人民币元，比例使用 0 至 100 的数字，日期格式为 YYYY-MM-DD。不要提取或输出身份证号、银行卡号、住址等与下列字段无关的敏感信息。

枚举要求：
- category: social / medical / life / pension / property / accident / other
- premiumFrequency: monthly / quarterly / yearly / one-time
- renewalType: guaranteed（保证续保）/ review_required（续保需审核）/ non_guaranteed（不保证续保）/ not_applicable（不适用）/ unknown（文件未说明）

返回结构：
{
  "name": null,
  "category": null,
  "insuredMemberName": null,
  "policyholderMemberName": null,
  "policyNumber": null,
  "insurer": null,
  "coverageAmount": null,
  "premium": null,
  "premiumFrequency": null,
  "cashValue": null,
  "startDate": null,
  "endDate": null,
  "coverageSummary": null,
  "coverageTerm": null,
  "deductible": null,
  "reimbursementRatio": null,
  "waitingPeriodDays": null,
  "renewalType": null,
  "renewalUntilAge": null,
  "annualLimit": null,
  "beneficiary": null,
  "keyClauses": null,
  "keyExclusions": null,
  "claimPhone": null,
  "claimChannels": null,
  "claimSteps": null,
  "claimMaterials": null,
  "claimNotes": null
}

其中 coverageSummary 请概括主要保障责任；keyClauses 记录重要给付条件、限制或除外前提；keyExclusions 记录责任免除。若文件内容存在冲突，请以保单特别约定优先，并在对应文本字段中注明来源。`;
}

const categoryValues = new Set(["social", "medical", "life", "pension", "property", "accident", "other"]);
const frequencyValues = new Set(["monthly", "quarterly", "yearly", "one-time"]);
const renewalValues = new Set(["guaranteed", "review_required", "non_guaranteed", "not_applicable", "unknown"]);
const textFields = [
  "name",
  "insuredMemberName",
  "policyholderMemberName",
  "policyNumber",
  "insurer",
  "coverageSummary",
  "coverageTerm",
  "beneficiary",
  "keyClauses",
  "keyExclusions",
  "claimPhone",
  "claimChannels",
  "claimSteps",
  "claimMaterials",
  "claimNotes",
] as const;
const numberFields = [
  "coverageAmount",
  "premium",
  "cashValue",
  "deductible",
  "reimbursementRatio",
  "waitingPeriodDays",
  "renewalUntilAge",
  "annualLimit",
] as const;

export function parseInsuranceExtraction(input: string): InsuranceExtractedData {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("没有找到完整的 JSON 对象，请让 AI 只返回 JSON 后再粘贴");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(input.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("JSON 格式无法解析，请检查是否缺少引号、逗号或大括号");
  }

  const result: Record<string, unknown> = {};
  for (const field of textFields) {
    if (typeof raw[field] === "string" && raw[field].trim()) result[field] = raw[field].trim();
  }
  for (const field of numberFields) {
    if (raw[field] === null || raw[field] === undefined || raw[field] === "") continue;
    const value = Number(raw[field]);
    if (Number.isFinite(value) && value >= 0) result[field] = value;
  }
  for (const field of ["startDate", "endDate"] as const) {
    if (typeof raw[field] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw[field])) result[field] = raw[field];
  }
  if (categoryValues.has(String(raw.category))) result.category = raw.category;
  if (frequencyValues.has(String(raw.premiumFrequency))) result.premiumFrequency = raw.premiumFrequency;
  if (renewalValues.has(String(raw.renewalType))) result.renewalType = raw.renewalType;
  return result as InsuranceExtractedData;
}
