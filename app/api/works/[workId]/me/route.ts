import { requireUser } from "@/lib/server/auth/guards";
import { setWorkWishlist } from "@/lib/server/db/work-community";
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
    if (typeof body.wishlisted !== "boolean") {
      return json({ ok: false, error: "wishlisted is required" }, { status: 400 });
    }
    await setWorkWishlist(
      parsePositiveId((await context.params).workId, "work id"),
      auth.user.id,
      body.wishlisted,
    );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Work preference update failed", error);
  }
}
