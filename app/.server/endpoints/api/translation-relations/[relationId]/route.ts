import { requireAnyPermission } from "@/app/.server/auth/authorize";
import { deleteTranslationRelation } from "@/app/.server/db/relations";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function DELETE(
  runtime: AppRuntime,
  request: Request,
  context: { params: { relationId: string } },
) {
  const auth = await requireAnyPermission(runtime, request, [
    "translation_relation.delete_any",
  ]);
  if ("response" in auth) return auth.response;
  try {
    await deleteTranslationRelation(
      runtime,
      parsePositiveId((await context.params).relationId, "relation id"),
      auth.user,
    );
    return json({ ok: true });
  } catch (error) {
    return jsonError("Translation relation deletion failed", error);
  }
}
