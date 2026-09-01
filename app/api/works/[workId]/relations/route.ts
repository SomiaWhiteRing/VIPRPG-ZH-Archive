import { requireAnyPermission } from "@/lib/server/auth/authorize";
import { createWorkRelation } from "@/lib/server/db/relations";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId, readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ workId: string }> },
) {
  const auth = await requireAnyPermission(request, [
    "relation.create",
    "relation.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const workId = parsePositiveId((await context.params).workId, "work id");
    const body = await readBody(request);
    const result = await createWorkRelation(
      {
        fromWorkId: workId,
        toWorkId: Number(body.targetWorkId),
        relationType: body.relationType as never,
        relationOrder: body.relationOrder,
      },
      auth.user,
    );
    return json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return jsonError("Relation creation failed", error);
  }
}

async function readBody(
  request: Request,
): Promise<{
  targetWorkId?: number;
  relationType?: string;
  relationOrder?: number;
}> {
  const body = await readJsonObject(request, "Invalid relation body");
  if (body.targetWorkId !== undefined && typeof body.targetWorkId !== "number")
    throw new HttpError(400, "Target work id must be a number");
  if (body.relationType !== undefined && typeof body.relationType !== "string")
    throw new HttpError(400, "Relation type must be a string");
  if (
    body.relationOrder !== undefined &&
    (typeof body.relationOrder !== "number" ||
      !Number.isFinite(body.relationOrder))
  )
    throw new HttpError(400, "Relation order must be a finite number");
  return body as {
    targetWorkId?: number;
    relationType?: string;
    relationOrder?: number;
  };
}
