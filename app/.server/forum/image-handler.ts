import { hasPermission } from "@/lib/authz/permissions";
import { HttpError, jsonError } from "@/lib/http";
import { loadRequestSession } from "../auth/request-auth";
import type { ForumRequestRuntime } from "./request";

export async function GET(
  ctx: ForumRequestRuntime,
  request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const { id } = await params;
    const row = await ctx.db
      .prepare(
        `SELECT object_key,format,size,user_id,post_id,
      EXISTS(SELECT 1 FROM forum_public_posts p WHERE p.id=forum_images.post_id) AS public
      FROM forum_images WHERE id=? AND status='ready'`,
      )
      .bind(id)
      .first<{
        object_key: string;
        format: string;
        size: number;
        user_id: number;
        post_id: number | null;
        public: number;
      }>();
    if (!row) throw new HttpError(404, "图片不可用。");
    if (!row.public) {
      const user = (
        await loadRequestSession(ctx.db, request.headers.get("cookie"))
      )?.user;
      if (
        !user ||
        !(
          hasPermission(user, "forum.content.moderate_any") ||
          (row.post_id === null && row.user_id === user.id)
        )
      )
        throw new HttpError(404, "图片不可用。");
    }
    const object = await ctx.bucket.get(row.object_key);
    if (!object) throw new HttpError(404, "图片不可用。");
    return new Response(object.body, {
      headers: {
        "Content-Type": `image/${row.format}`,
        "Content-Length": String(object.size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    return jsonError("图片读取失败。", error);
  }
}
