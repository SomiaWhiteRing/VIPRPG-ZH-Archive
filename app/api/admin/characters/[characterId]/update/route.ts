import { requirePermission } from "@/lib/server/auth/authorize";
import { writeAuthAuditLog } from "@/lib/server/db/auth-audit";
import {
  CharacterAliasMergeConflictError,
  getCharacterForAdminEdit,
  parseCharacterEditForm,
  updateCharacterForAdmin,
} from "@/lib/server/db/taxonomy-library";
import {
  getCharacterPortraitConfigurationForAdmin,
  parseCharacterPortraitLibraryForm,
  updateCharacterPortraitLibraryForAdmin,
} from "@/lib/server/db/character-portrait-library";
import { formOrJsonError, redirectResponse, requestWantsJson } from "@/lib/server/http/form";
import { HttpError, json } from "@/lib/server/http/json";

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

  const { characterId: rawCharacterId } = await context.params;
  const fallbackPath = /^[1-9]\d*$/.test(rawCharacterId)
    ? `/admin/characters/${rawCharacterId}`
    : "/admin/characters";
  try {
    const characterId = parseId(rawCharacterId);
    const formData = await request.formData();
    const parsedInput = parseCharacterEditForm(formData);
    const portraitLibrary = parseCharacterPortraitLibraryForm(formData);
    const input = parsedInput;

    if (input.characterId !== characterId) {
      throw new HttpError(400, "角色 ID 与当前页面不一致，请刷新页面后重试。", "character_id_mismatch");
    }

    const mergePortraitConfigurations = input.mergeSourceId
      ? await Promise.all([
          getCharacterPortraitConfigurationForAdmin(characterId),
          getCharacterPortraitConfigurationForAdmin(input.mergeSourceId),
        ])
      : null;
    let character = await updateCharacterForAdmin(input);
    if (!input.mergeTargetId) {
      const [currentPortraitConfiguration, sourcePortraitConfiguration] =
        mergePortraitConfigurations ?? [null, null];
      await updateCharacterPortraitLibraryForAdmin({
        characterId,
        faceSheetIds: sourcePortraitConfiguration
          ? [...new Set([
              ...portraitLibrary.faceSheetIds,
              ...sourcePortraitConfiguration.boundSheetIds,
            ])]
          : portraitLibrary.faceSheetIds,
        defaultPortrait: portraitLibrary.defaultPortrait
          ?? (
            currentPortraitConfiguration?.defaultPortrait === null
              ? sourcePortraitConfiguration?.defaultPortrait ?? null
              : null
          ),
        actorUserId: auth.user.id,
      });
      character = (await getCharacterForAdminEdit(characterId)) ?? character;
    }

    await writeAuthAuditLog({
      userId: auth.user.id,
      email: auth.user.email,
      eventType: "admin_character_update",
      detail: {
        characterId,
        resultingCharacterId: character.id,
        merged: Boolean(input.mergeTargetId || input.mergeSourceId),
        mergedSourceCharacterId: input.mergeSourceId,
        portraitLibraryUpdated: !input.mergeTargetId,
      },
    });

    const redirectTo = `/admin/characters/${character.id}`;
    if (requestWantsJson(request)) {
      return json({
        ok: true,
        redirectTo,
        character: {
          id: character.id,
          primaryName: character.primaryName,
          originalName: character.originalName,
          defaultPortrait: character.defaultPortrait,
          description: character.description,
          workCount: character.workCount,
        },
      });
    }

    return redirectResponse(new URL(redirectTo, request.url));
  } catch (error) {
    if (requestWantsJson(request) && error instanceof CharacterAliasMergeConflictError) {
      const aliases = error.aliases.map((alias) => `“${alias}”`).join("、");
      return json(
        {
          ok: false,
          error: "Character update requires confirmation",
          code: error.code,
          detail: error.message,
          confirmation: {
            title: "将重复角色合并到当前角色？",
            description: `日文别名${aliases}已归属于角色 #${error.candidate.id}“${error.candidate.originalName} · ${error.candidate.primaryName}”。确认后，该角色的作品关联、头像和别名会转移到当前角色 #${error.currentCharacterId}，旧角色记录会被删除，然后继续保存本页内容。此操作不可逆。`,
            confirmLabel: "合并并保存",
            fieldName: "merge_source_id",
            fieldValue: String(error.candidate.id),
          },
          timestamp: new Date().toISOString(),
        },
        { status: error.status },
      );
    }
    return formOrJsonError(request, fallbackPath, "Character update failed", error);
  }
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(400, "角色 ID 不合法，请返回角色维护页重新进入。", "character_id_invalid");
  }

  return id;
}
