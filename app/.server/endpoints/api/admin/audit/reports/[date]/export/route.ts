import { requirePermission } from "@/app/.server/auth/authorize";
import { exportDailyAuditReport } from "@/app/.server/db/audit-report-export";
import type { AppRuntime } from "@/app/.server/runtime";
import { jsonError } from "@/lib/http";

export async function GET(runtime: AppRuntime, request: Request, input: { params: Promise<{ date: string }> }) {
  const auth = await requirePermission(runtime, request, "audit.read");
  if ("response" in auth) return auth.response;
  try { return await exportDailyAuditReport(runtime, (await input.params).date); }
  catch (error) { return jsonError("日报导出失败", error); }
}
