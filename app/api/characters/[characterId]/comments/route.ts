import { getCurrentUserFromRequest } from "@/lib/server/auth/current-user";
import { requireUser } from "@/lib/server/auth/guards";
import { createComment, listRootComments } from "@/lib/server/db/work-community";
import { json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId, readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ characterId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const characterId = parsePositiveId((await context.params).characterId, "character id");
    const url = new URL(request.url);
    const user = await getCurrentUserFromRequest(request);
    const page = await listRootComments(
      { kind: "character", id: characterId },
      user?.id ?? null,
      url.searchParams.get("cursor"),
      Number(url.searchParams.get("limit") ?? 20),
    );
    return json({ ok: true, ...page });
  } catch (error) {
    return jsonError("Comments could not be loaded", error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "Invalid comment body");
    const replyTo = body.replyToCommentId === undefined ? undefined : Number(body.replyToCommentId);
    if (replyTo !== undefined && (!Number.isSafeInteger(replyTo) || replyTo <= 0)) {
      return json({ ok: false, error: "replyToCommentId is invalid" }, { status: 400 });
    }
    const characterId = parsePositiveId((await context.params).characterId, "character id");
    const comment = await createComment(
      { kind: "character", id: characterId },
      auth.user.id,
      body.body,
      replyTo,
    );
    return json({ ok: true, comment }, { status: 201 });
  } catch (error) {
    return jsonError("Comment creation failed", error);
  }
}
