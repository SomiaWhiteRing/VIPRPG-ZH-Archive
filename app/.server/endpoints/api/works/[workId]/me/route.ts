import { requireUser } from "@/app/.server/auth/guards";
import { setWorkFavorite } from "@/app/.server/db/work-community";
import { getWorkFavorite, listWorkTagSummaries } from "@/app/.server/db/user-work-tags";
import { getD1 } from "@/app/.server/db/d1";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function GET(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const favorite = await getWorkFavorite(runtime, parsePositiveId(context.params.workId, "work id"), auth.user.id);
    return json({ ok: true, ...favorite }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError("Work preference load failed", error);
  }
}

export async function PATCH(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "Invalid work preference body");
    if (typeof body.favorited !== "boolean") {
      return json(
        { ok: false, error: "favorited is required" },
        { status: 400 },
      );
    }
    const workId = parsePositiveId(context.params.workId, "work id");
    await setWorkFavorite(
      runtime,
      workId,
      auth.user.id,
      body.favorited,
      body.tags,
      body.note,
    );
    const summary = new URL(request.url).searchParams.get("summary");
    if (summary === "counts" || summary === "tags") {
      const favorite = await getD1(runtime).prepare(`SELECT
        (SELECT COUNT(*) FROM user_work_entries e JOIN users u ON u.id=e.user_id
          WHERE e.work_id=w.id AND e.favorited_at IS NOT NULL AND u.status='active') AS count,
        EXISTS(SELECT 1 FROM user_work_entries e WHERE e.work_id=w.id AND e.user_id=? AND e.favorited_at IS NOT NULL) AS favorited
        FROM public_works w WHERE w.id=?`).bind(auth.user.id, workId).first<{ count: number; favorited: number }>();
      return json({ ok: true, favorited: favorite ? favorite.favorited === 1 : body.favorited,
        ...(favorite ? { favoriteCount: favorite.count } : {}),
        ...(favorite && summary === "tags" ? { tags: await listWorkTagSummaries(runtime, workId) } : {}) });
    }
    return json({ ok: true });
  } catch (error) {
    return jsonError("Work preference update failed", error);
  }
}
