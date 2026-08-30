import { requirePermission } from "@/lib/server/auth/authorize";
import {
  markImportJobFailed,
  parseImportJobId,
  requiredOwnedImportJob,
} from "@/lib/server/db/import-jobs";
import { HttpError, json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ importJobId: string }> },
) {
  const auth = await requirePermission(request, "import_job.create");
  if ("response" in auth) return auth.response;
  try {
    const { importJobId } = await context.params;
    const id = parseImportJobId(importJobId);
    await requiredOwnedImportJob(id, auth.user);
    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body) || typeof body.message !== "string") {
      throw new HttpError(400, "失败信息格式不合法");
    }
    const stage = typeof body.stage === "string" ? body.stage : null;
    await markImportJobFailed(id, body.message, stage);
    return json({ ok: true, importJobId: id, status: "failed" });
  } catch (error) {
    return jsonError("上传失败状态记录失败", error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
