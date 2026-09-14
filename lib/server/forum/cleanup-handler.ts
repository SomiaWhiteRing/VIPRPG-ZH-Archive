import { requireForumUser, readForumBody, type ForumRequestRuntime } from "./request";
import { forumImageCleanupSql, reconcileForumImage } from "@/lib/server/forum/image-storage";
import { HttpError, jsonError } from "@/lib/server/http/json";

export async function POST(ctx: ForumRequestRuntime, request: Request) {
  try {
    const auth = await requireForumUser(ctx, request, ["forum.content.moderate_any"]);
    const bytes = await readForumBody(request);
    const form = await new Response(bytes, {headers:{"Content-Type":request.headers.get("content-type") ?? ""}}).formData(), id = form.get("id"), op = form.get("op");
    if (typeof id !== "string" || (op !== "cleanup" && op !== "reconcile"))
      throw new HttpError(400, "清理操作无效。");
    const db = ctx.db;
    if (op === "reconcile") {
      await reconcileForumImage(ctx, id);
    } else {
      const row = await db.prepare(`UPDATE forum_images AS i SET status='cleanup',updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status IN('ready','failed','cleanup')
          AND ${forumImageCleanupSql}
        RETURNING object_key`).bind(id).first<{ object_key: string }>();
      if (!row) {
        const cleaned = await db.prepare("SELECT object_key FROM forum_images WHERE id=? AND status='cleaned'")
          .bind(id).first<{ object_key: string }>();
        if (!cleaned) throw new HttpError(409, "图片尚不符合清理条件。请先隐藏帖子或主题，或核对上传状态。");
        await ctx.bucket.delete(cleaned.object_key);
      } else {
        // Retain the binding tombstone so restoration cannot silently lose images.
        await ctx.bucket.delete(row.object_key);
        await db.batch([
          db.prepare(`INSERT INTO auth_audit_logs(user_id,event_type,detail_json)
            SELECT ?,'forum_image_cleaned',? WHERE EXISTS(SELECT 1 FROM forum_images WHERE id=? AND status='cleanup')`)
            .bind(auth.user.id, JSON.stringify({ imageId: id }), id),
          db.prepare("UPDATE forum_images SET status='cleaned',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='cleanup'").bind(id),
        ]);
      }
    }
    return new Response(null, { status: 303, headers: { Location: "/admin/discussions/images", "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError("图片清理失败。", error);
  }
}
