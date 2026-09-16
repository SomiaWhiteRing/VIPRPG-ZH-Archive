import { requirePermission } from "@/app/.server/auth/authorize";
import {
  parseArchiveSourceManifest,
  verifyArchiveSourceManifest,
} from "@/app/.server/db/archive-commit";
import {
  markImportJobFailed,
  markImportJobSourceReady,
  parseImportJobId,
  requiredOwnedImportJob,
} from "@/app/.server/db/import-jobs";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { importJobId: string } },
) {
  const auth = await requirePermission(
    runtime,
    request,
    "import_job.preflight_own",
  );
  if ("response" in auth) return auth.response;

  let id: number | null = null;
  let authorized = false;
  try {
    const { importJobId } = await context.params;
    id = parseImportJobId(importJobId);
    await requiredOwnedImportJob(runtime, id, auth.user);
    authorized = true;
    const sourceManifest = await readBody(request);
    const sourceManifestSha256 = await verifyArchiveSourceManifest(
      runtime,
      sourceManifest,
    );
    await markImportJobSourceReady(runtime, id, sourceManifestSha256);
    return json({ ok: true, importJobId: id, status: "awaiting_metadata" });
  } catch (error) {
    if (id !== null && authorized) {
      await markImportJobFailed(
        runtime,
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
