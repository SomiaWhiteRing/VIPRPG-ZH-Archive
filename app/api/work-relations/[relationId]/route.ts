import { requireAnyPermission } from "@/lib/server/auth/authorize";
import {
  deleteWorkRelation,
  moveWorkRelation,
  updateWorkRelation,
} from "@/lib/server/db/relations";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId, readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ relationId: string }> },
) {
  const auth = await requireAnyPermission(request, [
    "relation.delete_own",
    "relation.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    await deleteWorkRelation(
      parsePositiveId((await context.params).relationId, "relation id"),
      auth.user,
    );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Relation deletion failed", error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ relationId: string }> },
) {
  const auth = await requireAnyPermission(request, [
    "relation.update_own",
    "relation.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const body = await readBody(request);
    const relationId = parsePositiveId(
      (await context.params).relationId,
      "relation id",
    );
    if (body.direction !== undefined)
      await moveWorkRelation(relationId, body.direction, auth.user);
    else
      await updateWorkRelation(
        relationId,
        {
          relationType: body.relationType as never,
          relationOrder: body.relationOrder,
          notes: body.notes,
        },
        auth.user,
      );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Relation update failed", error);
  }
}

async function readBody(
  request: Request,
): Promise<{
  relationType?: string;
  relationOrder?: number;
  notes?: string | null;
  direction?: number;
}> {
  const body = await readJsonObject(request, "Invalid relation body");
  if (
    body.notes !== undefined &&
    body.notes !== null &&
    typeof body.notes !== "string"
  )
    throw new HttpError(400, "Relation notes must be a string");
  if (body.relationType !== undefined && typeof body.relationType !== "string")
    throw new HttpError(400, "Relation type must be a string");
  if (
    body.relationOrder !== undefined &&
    typeof body.relationOrder !== "number"
  )
    throw new HttpError(400, "Relation order must be a number");
  if (
    body.direction !== undefined &&
    (typeof body.direction !== "number" ||
      !Number.isSafeInteger(body.direction) ||
      (body.direction !== -1 && body.direction !== 1))
  )
    throw new HttpError(400, "Relation direction must be -1 or 1");
  return body as {
    relationType?: string;
    relationOrder?: number;
    notes?: string | null;
    direction?: number;
  };
}
