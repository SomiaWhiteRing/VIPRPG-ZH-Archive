import { requirePermission } from "@/lib/server/auth/authorize";
import {
  parseImportJobId,
  requiredOwnedImportJob,
  resumeOwnedImportJob,
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
  const auth = await requirePermission(request, "import_job.create");
  if ("response" in auth) return auth.response;

  try {
    const { importJobId } = await context.params;
    const id = parseImportJobId(importJobId);
    await requiredOwnedImportJob(id, auth.user);
    const body = await readBody(request);
    const missing = await findMissingImportObjectReferences(body);
    if (missing.blobs.length || missing.corePacks.length) {
      throw new HttpError(409, "上传草稿引用的游戏文件已经不完整，请重新上传");
    }
    const job = await resumeOwnedImportJob(
      id,
      auth.user,
    );
    return json({
      ok: true,
      importJob: {
        id: job.id,
        workId: job.work_id,
        archiveVersionId: job.archive_version_id,
        status: job.status,
        sourceName: job.source_name,
        sourceSizeBytes: job.source_size_bytes,
        fileCount: job.file_count,
        updatedAt: job.updated_at,
        completedAt: job.completed_at,
      },
    });
  } catch (error) {
    return jsonError("上传草稿确认失败", error);
  }
}

async function readBody(request: Request) {
  const value: unknown = await request.json().catch(() => null);
  return parseImportObjectReferences(value, {
    invalidList: "上传草稿文件清单格式不合法",
    invalidHash: "上传草稿文件哈希格式不合法",
  });
}
