import type { FinancialDiagnosisReport } from "@caiwu/shared";
import type { FastifyInstance } from "fastify";
import {
  buildFinancialDiagnosis,
  captureFinancialSnapshot,
} from "../diagnosis/service.js";
import {
  generateFinancialDiagnosisAI,
  getLatestFinancialDiagnosisAI,
  saveFinancialDiagnosisAI,
} from "../ai/financial-diagnosis.js";
import { authGuard } from "../middleware/auth.js";

export async function financialDiagnosisRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.post("/snapshots/capture", async () => {
    const snapshot = captureFinancialSnapshot();
    return { success: true, snapshot };
  });

  app.get("/", async (): Promise<FinancialDiagnosisReport> => buildFinancialDiagnosis());

  app.get("/ai/latest", async (_request, reply) => {
    const saved = getLatestFinancialDiagnosisAI();
    if (!saved) return reply.status(404).send({ error: "还没有生成资产配置 AI 建议" });
    return saved;
  });

  app.post("/ai", async (request, reply) => {
    try {
      captureFinancialSnapshot();
      request.log.info("Generating AI financial diagnosis");
      const result = await generateFinancialDiagnosisAI();
      saveFinancialDiagnosisAI(result);
      request.log.info({ asOfDate: result.asOfDate }, "AI financial diagnosis generated");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "资产配置 AI 建议生成失败";
      request.log.error({ error: message }, "AI financial diagnosis failed");
      return reply.status(500).send({ error: message });
    }
  });
}
