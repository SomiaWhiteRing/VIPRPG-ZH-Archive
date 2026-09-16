import { requireAnyPermission } from "@/app/.server/auth/authorize";
import {
  deleteWorkRelation,
  updateWorkRelation,
} from "@/app/.server/db/relations";
import { parsePositiveId, readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json, jsonError } from "@/lib/http";

export async function DELETE(
  runtime: AppRuntime,
  request: Request,
  context: { params: { relationId: string } },
) {
  const auth = await requireAnyPermission(runtime, request, [
    "relation.delete_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    await deleteWorkRelation(
      runtime,
      parsePositiveId((await context.params).relationId, "relation id"),
      auth.user,
    );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Relation deletion failed", error);
  }
}

export async function PATCH(
  runtime: AppRuntime,
  request: Request,
  context: { params: { relationId: string } },
) {
  const auth = await requireAnyPermission(runtime, request, [
    "relation.update_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    const body = await readBody(request);
    const relationId = parsePositiveId(
      (await context.params).relationId,
      "relation id",
    );
    await updateWorkRelation(
      runtime,
      relationId,
      { relationType: body.relationType as never },
      auth.user,
    );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Relation update failed", error);
  }
}

async function readBody(request: Request): Promise<{ relationType: string }> {
  const body = await readJsonObject(request, "Invalid relation body");
  if (typeof body.relationType !== "string")
    throw new HttpError(400, "Relation type must be a string");
  return { relationType: body.relationType };
}
