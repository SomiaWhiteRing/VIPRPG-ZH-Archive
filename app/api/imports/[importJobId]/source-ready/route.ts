import { requirePermission } from "@/lib/server/auth/authorize";
import {
  markImportJobFailed,
  markImportJobSourceReady,
  parseImportJobId,
  requiredOwnedImportJob,
} from "@/lib/server/db/import-jobs";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import {
  findMissingImportObjectReferences,
  parseImportObjectReferences,
} from "@/lib/server/storage/import-object-references";

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
    const body = await readBody(request);
    const missing = await findMissingImportObjectReferences(body);
    if (missing.blobs.length || missing.corePacks.length) {
      throw new HttpError(
        409,
        `文件上传尚未完成：缺少 ${missing.blobs.length} 个文件对象和 ${missing.corePacks.length} 个公共文件包`,
      );
    }
    await markImportJobSourceReady(id);
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
  return parseImportObjectReferences(value, {
    invalidList: "文件清单格式不合法",
    invalidHash: "文件哈希格式不合法",
  });
}
