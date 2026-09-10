import { getCurrentUserFromRequest } from "@/lib/server/auth/current-user";
import { requireUser } from "@/lib/server/auth/guards";
import { createComment, listRootComments } from "@/lib/server/db/work-community";
import { json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId, readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ creatorId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const creatorId = parsePositiveId((await context.params).creatorId, "creator id");
    const url = new URL(request.url);
    const user = await getCurrentUserFromRequest(request);
    const page = await listRootComments(
      { kind: "creator", id: creatorId },
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
    const creatorId = parsePositiveId((await context.params).creatorId, "creator id");
    const comment = await createComment(
      { kind: "creator", id: creatorId },
      auth.user.id,
      body.body,
      replyTo,
    );
    return json({ ok: true, comment }, { status: 201 });
  } catch (error) {
    return jsonError("Comment creation failed", error);
  }
}
