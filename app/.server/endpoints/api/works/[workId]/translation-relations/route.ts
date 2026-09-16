import { requireAnyPermission } from "@/app/.server/auth/authorize";
import { createTranslationRelation } from "@/app/.server/db/relations";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json, jsonError } from "@/lib/http";

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: { params: { workId: string } },
) {
  const auth = await requireAnyPermission(runtime, request, [
    "translation_relation.create",
    "translation_relation.create_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const sourceWorkId = parsePositiveId(
      (await context.params).workId,
      "work id",
    );
    const body = await readBody(request);
    const result = await createTranslationRelation(
      runtime,
      {
        sourceWorkId,
        targetRole: body.targetRole as never,
        targetWorkId: Number(body.targetWorkId),
      },
      auth.user,
    );
    return json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return jsonError("Translation relation creation failed", error);
  }
}

async function readBody(request: Request): Promise<{
  targetRole?: "original" | "translation";
  targetWorkId?: number;
}> {
  const body = await readJsonObject(
    request,
    "Invalid translation relation body",
  );
  if (body.targetRole !== undefined && typeof body.targetRole !== "string")
    throw new HttpError(400, "Translation role must be a string");
  if (body.targetWorkId !== undefined && typeof body.targetWorkId !== "number")
    throw new HttpError(400, "Target work id must be a number");
  return body as {
    targetRole?: "original" | "translation";
    targetWorkId?: number;
  };
}
