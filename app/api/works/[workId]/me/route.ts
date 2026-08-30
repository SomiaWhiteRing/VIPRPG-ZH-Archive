import { requireUser } from "@/lib/server/auth/guards";
import { setWorkFavorite } from "@/lib/server/db/work-community";
import { json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId, readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ workId: string }> },
) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "Invalid work preference body");
    if (typeof body.favorited !== "boolean") {
      return json({ ok: false, error: "favorited is required" }, { status: 400 });
    }
    await setWorkFavorite(
      parsePositiveId((await context.params).workId, "work id"),
      auth.user.id,
      body.favorited,
    );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Work preference update failed", error);
  }
}
