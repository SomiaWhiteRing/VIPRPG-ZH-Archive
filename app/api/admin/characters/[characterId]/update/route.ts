import { requirePermission } from "@/lib/server/auth/authorize";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import {
  parseCharacterEditForm,
  updateCharacterForAdmin,
} from "@/lib/server/db/taxonomy-library";
import { redirectResponse } from "@/lib/server/http/form";
import { json, jsonError } from "@/lib/server/http/json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    characterId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requirePermission(request, "character.update");

  if ("response" in auth) {
    return auth.response;
  }

  try {
    const { characterId: rawCharacterId } = await context.params;
    const characterId = parseId(rawCharacterId);
    const formData = await request.formData();
    const input = parseCharacterEditForm(formData);

    if (input.characterId !== characterId) {
      throw new Error("Character id mismatch");
    }

    const character = await updateCharacterForAdmin(input);

    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_character_update",
      detail: {
        characterId,
        resultingCharacterId: character.id,
        merged: Boolean(input.mergeTargetId),
      },
    });

    if (request.headers.get("accept")?.includes("application/json")) {
      return json({
        ok: true,
        character: {
          id: character.id,
          primaryName: character.primaryName,
          originalName: character.originalName,
          description: character.description,
          workCount: character.workCount,
        },
      });
    }

    return redirectResponse(new URL(`/admin/characters/${character.id}`, request.url));
  } catch (error) {
    return jsonError("Character update failed", error);
  }
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid character id");
  }

  return id;
}
