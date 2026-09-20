import { getCurrentUser } from "@/app/.server/auth/current-user";
import { requireUser } from "@/app/.server/auth/guards";
import {
  createComment,
  listRootComments,
} from "@/app/.server/db/work-community";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

type RouteContext = {
  params: { creatorId: string };
};

export async function GET(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  try {
    const creatorId = parsePositiveId(
      (await context.params).creatorId,
      "creator id",
    );
    const url = new URL(request.url);
    const user = await getCurrentUser(runtime);
    const page = await listRootComments(
      runtime,
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

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const body = await readJsonObject(request, "Invalid comment body");
    const replyTo =
      body.replyToCommentId === undefined
        ? undefined
        : Number(body.replyToCommentId);
    if (
      replyTo !== undefined &&
      (!Number.isSafeInteger(replyTo) || replyTo <= 0)
    ) {
      return json(
        { ok: false, error: "replyToCommentId is invalid" },
        { status: 400 },
      );
    }
    const creatorId = parsePositiveId(
      (await context.params).creatorId,
      "creator id",
    );
    const comment = await createComment(
      runtime,
      { kind: "creator", id: creatorId },
      auth.user.id,
      body.body,
      replyTo,
      body.imageIds,
      body.requestKey,
    );
    return json({ ok: true, comment }, { status: 201 });
  } catch (error) {
    return jsonError("Comment creation failed", error);
  }
}
