import { requirePermission } from "@/app/.server/auth/authorize";
import { writeAuthAuditLog } from "@/app/.server/db/auth-audit";
import { createCharacterForAdmin } from "@/app/.server/db/taxonomy-library";
import { readJsonObject } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { json, jsonError } from "@/lib/http";

export async function POST(runtime: AppRuntime, request: Request) {
  const auth = await requirePermission(runtime, request, "character.create");
  if ("response" in auth) return auth.response;

  try {
    const body = await readJsonObject(request, "角色创建请求格式不合法");
    const result = await createCharacterForAdmin(runtime, {
      originalName: String(body.originalName ?? ""),
      primaryName: String(body.displayName ?? ""),
    });
    await writeAuthAuditLog(runtime, {
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_character_create",
      detail: {
        characterId: result.character.id,
        created: result.created,
      },
    });

    return json(
      {
        ok: true,
        redirectTo: `/admin/characters/${result.character.id}`,
        created: result.created,
        character: {
          id: result.character.id,
          primaryName: result.character.primaryName,
          originalName: result.character.originalName,
        },
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return jsonError("Character creation failed", error);
  }
}
