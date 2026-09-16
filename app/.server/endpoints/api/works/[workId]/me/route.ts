import { requireUser } from "@/app/.server/auth/guards";
import { setWorkFavorite } from "@/app/.server/db/work-community";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

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
    await setWorkFavorite(
      runtime,
      parsePositiveId((await context.params).workId, "work id"),
      auth.user.id,
      body.favorited,
    );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Work preference update failed", error);
  }
}
