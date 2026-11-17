import { parsePositiveId } from "@/app/.server/http/request";
import { requireAnyPermission } from "@/app/.server/auth/authorize";
import {
  getCharacterPortraitConfigurationForAdmin,
  parseCharacterPortraitLibraryForm,
  updateCharacterPortraitLibraryForAdmin,
} from "@/app/.server/db/character-portrait-library";
import {
  CharacterAliasMergeConflictError,
  getCharacterForAdminEdit,
  parseCharacterEditForm,
  updateCharacterForAdmin,
} from "@/app/.server/db/taxonomy-library";
import {
  formOrJsonError,
  redirectWithParams,
  requestWantsJson,
} from "@/app/.server/http/form";
import type { AppRuntime } from "@/app/.server/runtime";
import { hasPermission } from "@/lib/authz/permissions";
import { HttpError, json } from "@/lib/http";
import { translate } from "@/lib/i18n/core";
import { UiHttpError } from "@/lib/i18n/feedback";

type RouteContext = {
  params: {
    characterId: string;
  };
};

export async function POST(
  runtime: AppRuntime,
  request: Request,
  context: RouteContext,
) {
  const auth = await requireAnyPermission(runtime, request, [
    "character.metadata.update_any",
    "character.merge_any",
    "character.portrait.manage_any",
  ]);

  if ("response" in auth) {
    return auth.response;
  }

  const { characterId: rawCharacterId } = await context.params;
  const fallbackPath = /^[1-9]\d*$/.test(rawCharacterId)
    ? `/admin/characters/${rawCharacterId}`
    : "/admin/characters";
  try {
    const characterId = parsePositiveId(
      rawCharacterId,
      "character id",
      "角色 ID 不合法，请返回角色维护页重新进入。",
      "character_id_invalid",
    );
    const formData = await request.formData();
    const metadataRequested = [
      "primary_name",
      "original_name",
      "japanese_aliases",
      "chinese_aliases",
      "description",
    ].some((key) => formData.has(key));
    const portraitRequested =
      formData.has("face_sheet_ids") || formData.has("default_portrait");
    const mergeRequested = Boolean(
      String(formData.get("merge_target_id") ?? "").trim() ||
        String(formData.get("merge_source_id") ?? "").trim(),
    );
    if (
      (metadataRequested &&
        !hasPermission(auth.user, "character.metadata.update_any")) ||
      (portraitRequested &&
        !hasPermission(auth.user, "character.portrait.manage_any")) ||
      (mergeRequested && !hasPermission(auth.user, "character.merge_any"))
    ) {
      return json({ ok: false, error: "Permission denied" }, { status: 403 });
    }
    if (!metadataRequested && !portraitRequested && !mergeRequested)
      throw new HttpError(400, "没有可保存的修改", undefined, "admin.characterDetail.error.noChanges");
    const currentCharacter = await getCharacterForAdminEdit(
      runtime,
      characterId,
    );
    if (!currentCharacter) throw new HttpError(404, "角色不存在", undefined, "comment.error.characterMissing");
    if (!metadataRequested) {
      formData.set("primary_name", currentCharacter.primaryName);
      formData.set("original_name", currentCharacter.originalName);
      formData.set(
        "japanese_aliases",
        currentCharacter.aliases
          .filter((alias) => alias.language === "ja")
          .map((alias) => alias.name)
          .join("\n"),
      );
      formData.set(
        "chinese_aliases",
        currentCharacter.aliases
          .filter((alias) => alias.language === "zh")
          .map((alias) => alias.name)
          .join("\n"),
      );
    }
    const input = parseCharacterEditForm(formData);
    const portraitLibrary = portraitRequested
      ? parseCharacterPortraitLibraryForm(formData)
      : null;

    if (input.characterId !== characterId) {
      throw new HttpError(
        400,
        "角色 ID 与当前页面不一致，请刷新页面后重试。",
        "character_id_mismatch",
        "admin.characterDetail.error.idMismatch",
      );
    }

    const mergePortraitConfigurations =
      portraitLibrary && input.mergeSourceId
        ? await Promise.all([
            getCharacterPortraitConfigurationForAdmin(runtime, characterId),
            getCharacterPortraitConfigurationForAdmin(
              runtime,
              input.mergeSourceId,
            ),
          ])
        : null;
    let character =
      metadataRequested || mergeRequested
        ? await updateCharacterForAdmin(runtime, input, auth.user)
        : currentCharacter;
    if (portraitLibrary && !input.mergeTargetId) {
      const [currentPortraitConfiguration, sourcePortraitConfiguration] =
        mergePortraitConfigurations ?? [null, null];
      await updateCharacterPortraitLibraryForAdmin(runtime, {
        characterId,
        faceSheetIds: sourcePortraitConfiguration
          ? [
              ...new Set([
                ...portraitLibrary.faceSheetIds,
                ...sourcePortraitConfiguration.boundSheetIds,
              ]),
            ]
          : portraitLibrary.faceSheetIds,
        defaultPortrait:
          portraitLibrary.defaultPortrait ??
          (currentPortraitConfiguration?.defaultPortrait === null
            ? (sourcePortraitConfiguration?.defaultPortrait ?? null)
            : null),
        actorUserId: auth.user.id,
      }, auth.user);
      character =
        (await getCharacterForAdminEdit(runtime, characterId)) ?? character;
    }

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
          workCount: character.workCount,
        },
      });
    }

    return redirectWithParams(request, redirectTo, {});
  } catch (error) {
    if (
      error instanceof CharacterAliasMergeConflictError &&
      !hasPermission(auth.user, "character.merge_any")
    ) {
      return formOrJsonError(
        request,
        fallbackPath,
        "Character update failed",
        new UiHttpError(409, "admin.characterDetail.aliasMergeForbidden"),
        runtime.uiLocale,
      );
    }
    if (
      requestWantsJson(request) &&
      error instanceof CharacterAliasMergeConflictError
    ) {
      const locale = runtime.uiLocale;
      const conflict = {
        aliases: error.aliases.map((alias) => `“${alias}”`).join(locale === "en" ? ", " : "、"),
        candidateId: error.candidate.id,
        candidateName: `${error.candidate.originalName} · ${error.candidate.primaryName}`,
        currentId: error.currentCharacterId,
      };
      return json(
        {
          ok: false,
          error: "Character update requires confirmation",
          code: error.code,
          detail: translate(locale, "admin.characterDetail.aliasMergeConflict", conflict),
          confirmation: {
            title: translate(locale, "admin.characterDetail.aliasMergeTitle"),
            description: translate(locale, "admin.characterDetail.aliasMergeDescription", conflict),
            confirmLabel: translate(locale, "admin.characterDetail.aliasMergeConfirm"),
            fieldName: "merge_source_id",
            fieldValue: String(error.candidate.id),
          },
          timestamp: new Date().toISOString(),
        },
        { status: error.status },
      );
    }
    return formOrJsonError(
      request,
      fallbackPath,
      "Character update failed",
      error,
      runtime.uiLocale,
    );
  }
}
