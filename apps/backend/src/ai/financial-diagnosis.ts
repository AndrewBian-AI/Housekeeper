import type {
  FinancialDiagnosisAIResponse,
  FinancialDiagnosisReport,
} from "@caiwu/shared";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/connection.js";
import { financialDiagnosisAnalyses } from "../db/schema.js";
import { buildFinancialDiagnosis } from "../diagnosis/service.js";
import { chat } from "./deepseek.js";
import { getFinancialDiagnosisPrompt } from "./prompts.js";

function buildDiagnosisMessage(report: FinancialDiagnosisReport): string {
  return `请根据以下由系统确定性计算得到的家庭财务诊断快照生成分析建议。

重要说明：
- JSON 中的数值已经计算完成，请直接解释，不要自行重新计算或修改。
- warnings 和 methodologyNotes 是必须遵守的数据边界。
- allocation.totalBalanceSheetAssets 是家庭全部资产；allocation.totalAssets 仅为参与目标比例比较的可配置金融资产。
- allocation.assets 提供每项资产的变现能力、调整方式、用途和是否纳入配置分析，必须逐项遵守。
- allocation.items 中的 targetRatio 是用户当前在系统中设置的目标，不等于 AI 建议比例。
- future_cash_flow 资产只能建议调整未来新增资金，excluded 资产不能为了追目标比例而被建议出售。
- 如果提出新的参考比例，请明确标注“AI 参考比例”，适用范围仅为可配置金融资产，四类合计 100%，并说明建议依据。

诊断快照：
${JSON.stringify(report, null, 2)}`;
}

export async function generateFinancialDiagnosisAI(): Promise<FinancialDiagnosisAIResponse> {
  const snapshot = buildFinancialDiagnosis();
  const analysis = (
    await chat(getFinancialDiagnosisPrompt(), buildDiagnosisMessage(snapshot))
  ).trim();
  if (!analysis) throw new Error("AI 未返回有效的资产配置诊断内容");

  return {
    asOfDate: snapshot.asOfDate,
    generatedAt: new Date().toISOString(),
    analysis,
    snapshot,
  };
}

export function saveFinancialDiagnosisAI(result: FinancialDiagnosisAIResponse): void {
  const now = new Date().toISOString();
  const existing = db
    .select({ id: financialDiagnosisAnalyses.id })
    .from(financialDiagnosisAnalyses)
    .where(eq(financialDiagnosisAnalyses.asOfDate, result.asOfDate))
    .get();
  const values = {
    analysis: result.analysis,
    snapshot: JSON.stringify(result.snapshot),
    generatedAt: result.generatedAt,
    updatedAt: now,
  };

  if (existing) {
    db.update(financialDiagnosisAnalyses)
      .set(values)
      .where(eq(financialDiagnosisAnalyses.id, existing.id))
      .run();
    return;
  }

  db.insert(financialDiagnosisAnalyses)
    .values({
      id: nanoid(),
      asOfDate: result.asOfDate,
      ...values,
      createdAt: now,
    })
    .run();
}

export function getLatestFinancialDiagnosisAI(): FinancialDiagnosisAIResponse | null {
  const row = db
    .select()
    .from(financialDiagnosisAnalyses)
    .orderBy(desc(financialDiagnosisAnalyses.generatedAt))
    .get();
  if (!row) return null;

  return {
    asOfDate: row.asOfDate,
    generatedAt: row.generatedAt,
    analysis: row.analysis,
    snapshot: JSON.parse(row.snapshot) as FinancialDiagnosisReport,
  };
}
