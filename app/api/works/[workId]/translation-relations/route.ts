import { requireAnyPermission } from "@/lib/server/auth/authorize";
import { createTranslationRelation } from "@/lib/server/db/relations";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId, readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ workId: string }> },
) {
  const auth = await requireAnyPermission(request, [
    "translation_relation.create",
    "translation_relation.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const sourceWorkId = parsePositiveId(
      (await context.params).workId,
      "work id",
    );
    const body = await readBody(request);
    const result = await createTranslationRelation(
      {
        sourceWorkId,
        targetRole: body.targetRole as never,
        targetWorkId: Number(body.targetWorkId),
        relationOrder: body.relationOrder,
      },
      auth.user,
    );
    return json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return jsonError("Translation relation creation failed", error);
  }
}

async function readBody(
  request: Request,
): Promise<{
  targetRole?: "original" | "translation";
  targetWorkId?: number;
  relationOrder?: number;
}> {
  const body = await readJsonObject(
    request,
    "Invalid translation relation body",
  );
  if (body.targetRole !== undefined && typeof body.targetRole !== "string")
    throw new HttpError(400, "Translation role must be a string");
  if (body.targetWorkId !== undefined && typeof body.targetWorkId !== "number")
    throw new HttpError(400, "Target work id must be a number");
  if (
    body.relationOrder !== undefined &&
    (typeof body.relationOrder !== "number" ||
      !Number.isFinite(body.relationOrder))
  )
    throw new HttpError(400, "Relation order must be a finite number");
  return body as {
    targetRole?: "original" | "translation";
    targetWorkId?: number;
    relationOrder?: number;
  };
}
