import type { FinancialDiagnosisReport } from "@caiwu/shared";
import type { FastifyInstance } from "fastify";
import {
  buildFinancialDiagnosis,
  captureFinancialSnapshot,
} from "../diagnosis/service.js";
import { authGuard } from "../middleware/auth.js";

export async function financialDiagnosisRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authGuard);

  app.post("/snapshots/capture", async () => {
    const snapshot = captureFinancialSnapshot();
    return { success: true, snapshot };
  });

  app.get("/", async (): Promise<FinancialDiagnosisReport> => buildFinancialDiagnosis());
}
