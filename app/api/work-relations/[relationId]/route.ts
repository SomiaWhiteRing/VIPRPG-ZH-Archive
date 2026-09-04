import { requireAnyPermission } from "@/lib/server/auth/authorize";
import {
  deleteWorkRelation,
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
    await updateWorkRelation(
      relationId,
      { relationType: body.relationType as never },
      auth.user,
    );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Relation update failed", error);
  }
}

async function readBody(
  request: Request,
): Promise<{ relationType: string }> {
  const body = await readJsonObject(request, "Invalid relation body");
  if (typeof body.relationType !== "string")
    throw new HttpError(400, "Relation type must be a string");
  return { relationType: body.relationType };
}
