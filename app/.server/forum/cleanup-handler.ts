import {
  forumImageCleanupSql,
  reconcileForumImage,
} from "@/app/.server/forum/image-storage";
import { HttpError, jsonError } from "@/lib/http";
import { translate } from "@/lib/i18n/core";
import { preserveUiLocale, type UiLocale } from "@/lib/i18n/locale";
import type { ForumRequestRuntime } from "./request";
import { readForumBody, requireForumUser } from "./request";

export async function POST(ctx: ForumRequestRuntime, request: Request, locale: UiLocale) {
  try {
    const auth = await requireForumUser(ctx, request, [
      "forum.content.moderate_any",
    ], locale);
    const bytes = await readForumBody(request);
    const form = await new Response(bytes, {
        headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      }).formData(),
      id = form.get("id"),
      op = form.get("op");
    if (typeof id !== "string" || (op !== "cleanup" && op !== "reconcile"))
      throw new HttpError(400, translate(locale, "admin.discussions.imageInvalid"));
    const db = ctx.db;
    if (op === "reconcile") {
      await reconcileForumImage(ctx, id, locale);
    } else {
      const row = await db
        .prepare(
          `UPDATE forum_images AS i SET status='cleanup',updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status IN('ready','failed','cleanup')
          AND ${forumImageCleanupSql}
        RETURNING object_key`,
        )
        .bind(id)
        .first<{ object_key: string }>();
      if (!row) {
        const cleaned = await db
          .prepare(
            "SELECT object_key FROM forum_images WHERE id=? AND status='cleaned'",
          )
          .bind(id)
          .first<{ object_key: string }>();
        if (!cleaned)
          throw new HttpError(
            409,
            translate(locale, "admin.discussions.imageConflict"),
          );
        await ctx.bucket.delete(cleaned.object_key);
      } else {
        // Retain the binding tombstone so restoration cannot silently lose images.
        await ctx.bucket.delete(row.object_key);
        await db.batch([
          db
            .prepare(
              `INSERT INTO auth_audit_logs(user_id,event_type,detail_json)
            SELECT ?,'forum_image_cleaned',? WHERE EXISTS(SELECT 1 FROM forum_images WHERE id=? AND status='cleanup')`,
            )
            .bind(auth.user.id, JSON.stringify({ imageId: id }), id),
          db
            .prepare(
              "UPDATE forum_images SET status='cleaned',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='cleanup'",
            )
            .bind(id),
        ]);
      }
    }
    const url = new URL(request.url);
    const target = preserveUiLocale(new URL("/admin/discussions/images", url), url);
    return new Response(null, {
      status: 303,
      headers: {
        Location: target.pathname + target.search,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(translate(locale, "admin.discussions.imageFailed"), error);
  }
}
