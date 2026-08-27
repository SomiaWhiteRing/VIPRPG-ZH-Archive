import { requireAnyPermission } from "@/lib/server/auth/authorize";
import {
  deleteTranslationRelation,
  moveTranslationRelation,
  updateTranslationRelationOrder,
} from "@/lib/server/db/relations";
import { HttpError, json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId, readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ relationId: string }> },
) {
  const auth = await requireAnyPermission(request, [
    "translation_relation.delete_own",
    "translation_relation.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    await deleteTranslationRelation(
      parsePositiveId((await context.params).relationId, "relation id"),
      auth.user,
    );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Translation relation deletion failed", error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ relationId: string }> },
) {
  const auth = await requireAnyPermission(request, [
    "translation_relation.update_own",
    "translation_relation.manage_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const body = await readBody(request);
    const relationId = parsePositiveId(
      (await context.params).relationId,
      "relation id",
    );
    if (body.direction !== undefined)
      await moveTranslationRelation(relationId, body.direction, auth.user);
    else
      await updateTranslationRelationOrder(
        relationId,
        body.relationOrder,
        auth.user,
      );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Translation relation update failed", error);
  }
}

async function readBody(
  request: Request,
): Promise<{ relationOrder: number; direction?: number }> {
  const body = await readJsonObject(
    request,
    "Invalid translation relation body",
  );
  const relationOrder = body.relationOrder;
  const direction = body.direction;
  if (
    relationOrder !== undefined &&
    (typeof relationOrder !== "number" || !Number.isFinite(relationOrder))
  )
    throw new HttpError(400, "Relation order must be a finite number");
  if (
    direction !== undefined &&
    (typeof direction !== "number" ||
      !Number.isSafeInteger(direction) ||
      (direction !== -1 && direction !== 1))
  )
    throw new HttpError(400, "Relation direction must be -1 or 1");
  if (relationOrder === undefined && direction === undefined)
    throw new HttpError(400, "Relation order or direction is required");
  return {
    relationOrder: relationOrder as number,
    direction: direction as number | undefined,
  };
}
