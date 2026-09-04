import { requireAnyPermission } from "@/lib/server/auth/authorize";
import { deleteTranslationRelation } from "@/lib/server/db/relations";
import { json, jsonError } from "@/lib/server/http/json";
import { parsePositiveId } from "@/lib/server/http/request";

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
