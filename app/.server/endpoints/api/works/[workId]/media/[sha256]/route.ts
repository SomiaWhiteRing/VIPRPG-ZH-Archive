import { requireAnyPermission } from "@/app/.server/auth/authorize";
import { normalizeSha256 } from "@/app/.server/crypto/sha256";
import { getD1 } from "@/app/.server/db/d1";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { streamValidatedImage } from "@/app/.server/storage/work-images";
import { hasPermission } from "@/lib/authz/permissions";
import { HttpError, jsonError } from "@/lib/http";

export async function GET(runtime: AppRuntime, request: Request, context: { params: { workId: string; sha256: string } }) {
  const auth = await requireAnyPermission(runtime, request, ["work.read_private", "work.update_own"]);
  if ("response" in auth) return auth.response;
  try {
    const workId = parsePositiveId(context.params.workId, "work id");
    const sha256 = normalizeSha256(context.params.sha256);
    const allowed = await getD1(runtime).prepare(`SELECT 1 FROM work_media_assets wma
      JOIN works w ON w.id=wma.work_id JOIN media_assets ma ON ma.id=wma.media_asset_id
      JOIN blobs b ON b.sha256=ma.blob_sha256 AND b.status='active'
      WHERE w.id=? AND ma.blob_sha256=? AND (?=1 OR (w.status<>'deleted' AND ?=1 AND EXISTS
        (SELECT 1 FROM work_uploaders wu WHERE wu.work_id=w.id AND wu.user_id=?)))`)
      .bind(workId, sha256, hasPermission(auth.user, "work.read_private") ? 1 : 0,
        hasPermission(auth.user, "work.update_own") ? 1 : 0, auth.user.id).first();
    if (!allowed) throw new HttpError(404, "图片不存在或无权访问");
    const image = await streamValidatedImage(runtime, sha256);
    return new Response(image.body, { headers: {
      "Content-Type": image.contentType, "Content-Length": String(image.size),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return jsonError("作品图片读取失败", error); }
}
