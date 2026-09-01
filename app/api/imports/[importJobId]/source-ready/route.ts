import { requirePermission } from "@/lib/server/auth/authorize";
import {
  markImportJobFailed,
  markImportJobSourceReady,
  parseImportJobId,
  requiredOwnedImportJob,
} from "@/lib/server/db/import-jobs";
import {
  parseArchiveSourceManifest,
  verifyArchiveSourceManifest,
} from "@/lib/server/db/archive-commit";
import { HttpError, json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ importJobId: string }> },
) {
  const auth = await requirePermission(request, "import_job.preflight_own");
  if ("response" in auth) return auth.response;

  let id: number | null = null;
  let authorized = false;
  try {
    const { importJobId } = await context.params;
    id = parseImportJobId(importJobId);
    await requiredOwnedImportJob(id, auth.user);
    authorized = true;
    const sourceManifest = await readBody(request);
    const sourceManifestSha256 = await verifyArchiveSourceManifest(sourceManifest);
    await markImportJobSourceReady(id, sourceManifestSha256);
    return json({ ok: true, importJobId: id, status: "awaiting_metadata" });
  } catch (error) {
    if (id !== null && authorized) {
      await markImportJobFailed(
        id,
        error instanceof Error ? error.message : "Unknown error",
        "source_verification",
      ).catch(() => undefined);
    }
    return jsonError("上传文件确认失败", error);
  }
}

async function readBody(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(400, "请求内容不是有效 JSON");
  }
  return parseArchiveSourceManifest(value);
}
