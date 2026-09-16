import { requirePermission } from "@/app/.server/auth/authorize";
import {
  markImportJobMetadataReady,
  parseImportJobId,
  requiredOwnedImportJob,
} from "@/app/.server/db/import-jobs";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { importJobId: string } },
) {
  const auth = await requirePermission(
    runtime,
    request,
    "import_job.commit_own",
  );
  if ("response" in auth) return auth.response;

  try {
    const { importJobId } = await context.params;
    const id = parseImportJobId(importJobId);
    await requiredOwnedImportJob(runtime, id, auth.user);
    await markImportJobMetadataReady(runtime, id);
    return json({ ok: true, importJobId: id, status: "uploading_metadata" });
  } catch (error) {
    return jsonError("作品资料上传准备失败", error);
  }
}
