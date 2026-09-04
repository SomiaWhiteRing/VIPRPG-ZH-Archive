import { requirePermission } from "@/lib/server/auth/authorize";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import { createCharacterForAdmin } from "@/lib/server/db/taxonomy-library";
import { json, jsonError } from "@/lib/server/http/json";
import { readJsonObject } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requirePermission(request, "character.update");
  if ("response" in auth) return auth.response;

  try {
    const body = await readJsonObject(request, "角色创建请求格式不合法");
    const result = await createCharacterForAdmin({
      originalName: String(body.originalName ?? ""),
      primaryName: String(body.displayName ?? ""),
    });
    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_character_create",
      detail: {
        characterId: result.character.id,
        created: result.created,
      },
    });

    return json({
      ok: true,
      redirectTo: `/admin/characters/${result.character.id}`,
      created: result.created,
      character: {
        id: result.character.id,
        primaryName: result.character.primaryName,
        originalName: result.character.originalName,
      },
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return jsonError("Character creation failed", error);
  }
}
