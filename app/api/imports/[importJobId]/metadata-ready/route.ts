import { requirePermission } from "@/lib/server/auth/authorize";
import {
  markImportJobMetadataReady,
  parseImportJobId,
  requiredOwnedImportJob,
} from "@/lib/server/db/import-jobs";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ importJobId: string }> },
) {
  const auth = await requirePermission(request, "import_job.commit_own");
  if ("response" in auth) return auth.response;

  try {
    const { importJobId } = await context.params;
    const id = parseImportJobId(importJobId);
    await requiredOwnedImportJob(id, auth.user);
    await markImportJobMetadataReady(id);
    return json({ ok: true, importJobId: id, status: "uploading_metadata" });
  } catch (error) {
    return jsonError("作品资料上传准备失败", error);
  }
}
