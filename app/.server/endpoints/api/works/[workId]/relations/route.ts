import { requireAnyPermission } from "@/app/.server/auth/authorize";
import { createWorkRelation } from "@/app/.server/db/relations";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
) {
  const auth = await requireAnyPermission(runtime, request, [
    "relation.create",
    "relation.create_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const workId = parsePositiveId((await context.params).workId, "work id");
    const body = await readBody(request);
    const result = await createWorkRelation(
      runtime,
      {
        fromWorkId: workId,
        toWorkId: Number(body.targetWorkId),
        relationType: body.relationType as never,
      },
      auth.user,
    );
    return json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return jsonError("Relation creation failed", error);
  }
}

async function readBody(request: Request): Promise<{
  targetWorkId?: number;
  relationType?: string;
}> {
  const body = await readJsonObject(request, "Invalid relation body");
  if (body.targetWorkId !== undefined && typeof body.targetWorkId !== "number")
    throw new HttpError(400, "Target work id must be a number");
  if (body.relationType !== undefined && typeof body.relationType !== "string")
    throw new HttpError(400, "Relation type must be a string");
  return body as {
    targetWorkId?: number;
    relationType?: string;
  };
}
