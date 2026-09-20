import { getCurrentUser } from "@/app/.server/auth/current-user";
import { requireUser } from "@/app/.server/auth/guards";
import {
  createComment,
  listRootComments,
} from "@/app/.server/db/work-community";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function GET(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
) {
  try {
    const workId = parsePositiveId((await context.params).workId, "work id");
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const user = await getCurrentUser(runtime);
    const page = await listRootComments(
      runtime,
      { kind: "work", id: workId },
      user?.id ?? null,
      url.searchParams.get("cursor"),
      limit,
    );
    return json({ ok: true, ...page });
  } catch (error) {
    return jsonError("Comments could not be loaded", error);
  }
}

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
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
    const comment = await createComment(
      runtime,
      {
        kind: "work",
        id: parsePositiveId((await context.params).workId, "work id"),
      },
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
