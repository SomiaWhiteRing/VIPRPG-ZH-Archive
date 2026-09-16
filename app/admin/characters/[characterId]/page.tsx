import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { readCharacterIndex } from "@/app/.server/db/character-index";
import { getCharacterPortraitLibraryForAdmin } from "@/app/.server/db/character-portrait-library";
import {
  getCharacterForAdminEdit,
  listCharactersForAdmin,
} from "@/app/.server/db/taxonomy-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { StickySaveBar } from "@/app/admin/admin-list-controls";
import { BackLink } from "@/app/components/ui/back-link";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Notice } from "@/app/components/ui/notice";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { Textarea } from "@/app/components/ui/textarea";
import {
  CHARACTER_DETAIL_PERMISSIONS,
  CHARACTER_INDEX_PERMISSIONS,
  hasPermission,
} from "@/lib/authz/permissions";
import { Link } from "react-router";
import { CharacterMergeTargetField } from "./character-merge-target-field";
import { PortraitLibraryEditor } from "./portrait-library-editor";

const CHARACTER_EDIT_FORM_ID = "character-edit-form";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);

  const { characterId: rawCharacterId } = await params;
  const query = await searchParams;
  const formError = Array.isArray(query.error) ? query.error[0] : query.error;
  const characterId = parseId(rawCharacterId);
  const adminUser = await requireAnyPagePermission(
    runtime,
    `/admin/characters/${characterId}`,
    CHARACTER_DETAIL_PERMISSIONS,
  );
  const canEdit = hasPermission(adminUser, "character.metadata.update_any");
  const canMerge = hasPermission(adminUser, "character.merge_any");
  const canManagePortrait = hasPermission(
    adminUser,
    "character.portrait.manage_any",
  );
  const canUploadPortrait = hasPermission(
    adminUser,
    "character.portrait.upload",
  );
  const [character, candidates, portraitLibrary, characterIndex] =
    await Promise.all([
      getCharacterForAdminEdit(runtime, characterId),
      listCharactersForAdmin(runtime, 2000),
      getCharacterPortraitLibraryForAdmin(runtime, characterId),
      readCharacterIndex(runtime),
    ]);

  if (!character) {
    throwNotFound();
  }

  return {
    formError,
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    canEdit,
    canMerge,
    canManagePortrait,
    canUploadPortrait,
    character,
    candidates,
    portraitLibrary,
    characterIndex,
  };
}

export default function AdminCharacterEditPage() {
  const {
    formError,
    adminUser,
    canEdit,
    canMerge,
    canManagePortrait,
    canUploadPortrait,
    character,
    candidates,
    portraitLibrary,
    characterIndex,
  } = useLoaderData<typeof loader>();
  return (
    <main key={character.id}>
      <PageHeader
        compact
        title={character.primaryName}
        actions={
          <>
            <BackLink href="/admin/characters" label="返回角色维护" />
            {CHARACTER_INDEX_PERMISSIONS.some((key) =>
              hasPermission(adminUser, key),
            ) ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                to={`/admin/characters/index?character=${character.id}`}
              >
                编辑所属分类
              </Link>
            ) : null}
            {character.workCount > 0 ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                to={`/games?character=${character.id}`}
              >
                查看作品
              </Link>
            ) : null}
          </>
        }
      />

      {formError ? (
        <Notice tone="error" className="mb-4 border p-3 text-sm" role="alert">
          {formError}
        </Notice>
      ) : null}

      <section
        id="portrait-workbench"
        className="min-w-0"
        aria-labelledby="material-workbench-heading"
      >
        <h2 id="material-workbench-heading" className="mb-4 text-lg font-bold">
          素材工作台
        </h2>
        <PortraitLibraryEditor
          key={character.id}
          canManage={canManagePortrait}
          canUpload={canUploadPortrait}
          characterIndex={characterIndex}
          initialSheets={portraitLibrary.sheets}
          initialMaterials={portraitLibrary.materials}
          characterId={character.id}
          characterName={character.primaryName}
          characterOriginalName={character.originalName}
          defaultPortrait={portraitLibrary.defaultPortrait}
          initialBoundSheetIds={portraitLibrary.boundSheetIds}
          initialBoundMaterialIds={portraitLibrary.boundMaterialIds}
        />
      </section>

      <ConfirmingForm
        action={`/api/admin/characters/${character.id}/update`}
        className="grid gap-4"
        confirmField="merge_target_id"
        errorTitle="角色资料保存失败"
        id={CHARACTER_EDIT_FORM_ID}
        method="post"
        title="确认合并并删除角色"
        description="目标角色会接收现有关联，当前角色将被删除。此操作不可逆，请确认目标名称正确。"
      >
        <input name="character_id" type="hidden" value={character.id} />

        <Pane heading="基础信息">
          <fieldset disabled={!canEdit} className="grid gap-4 md:grid-cols-2">
            <FormField
              controlId="admin-characters-characterId--field-1"
              label="名称"
            >
              <Input
                id="admin-characters-characterId--field-1"
                defaultValue={character.primaryName}
                name="primary_name"
                required
              />
            </FormField>
            <FormField
              controlId="admin-characters-characterId--field-2"
              label="原名"
            >
              <Input
                id="admin-characters-characterId--field-2"
                defaultValue={character.originalName}
                name="original_name"
                required
              />
            </FormField>
            <FormField
              controlId="admin-characters-characterId--field-3"
              hint="每行一个；可添加、修改或删除。"
              label="日文别名"
            >
              <Textarea
                aria-describedby="admin-characters-characterId--field-3-hint"
                id="admin-characters-characterId--field-3"
                defaultValue={character.aliases
                  .filter((alias) => alias.language === "ja")
                  .map((alias) => alias.name)
                  .join("\n")}
                name="japanese_aliases"
                rows={5}
              />
            </FormField>
            <FormField
              controlId="admin-characters-characterId--field-4"
              hint="每行一个；角色名称本身不必重复填写。"
              label="中文别名"
            >
              <Textarea
                aria-describedby="admin-characters-characterId--field-4-hint"
                id="admin-characters-characterId--field-4"
                defaultValue={character.aliases
                  .filter((alias) => alias.language === "zh")
                  .map((alias) => alias.name)
                  .join("\n")}
                name="chinese_aliases"
                rows={5}
              />
            </FormField>
          </fieldset>
        </Pane>

        {canMerge ? (
          <Pane heading="合并重复角色" tone="danger">
            <FormField
              controlId="admin-characters-characterId--field-5"
              hint="提交后，登场关系会移至目标角色，当前角色会被删除。"
              hintId="character-merge-target-hint"
              label="目标角色"
            >
              <CharacterMergeTargetField
                id="admin-characters-characterId--field-5"
                candidates={candidates
                  .filter((candidate) => candidate.id !== character.id)
                  .map((candidate) => ({
                    id: candidate.id,
                    originalName: candidate.originalName,
                    primaryName: candidate.primaryName,
                    workCount: candidate.workCount,
                  }))}
                descriptionId="character-merge-target-hint"
                name="merge_target_id"
              />
            </FormField>
          </Pane>
        ) : null}

        {canEdit || canMerge ? (
          <StickySaveBar>
            <Button type="submit">保存角色资料</Button>
          </StickySaveBar>
        ) : null}
      </ConfirmingForm>
    </main>
  );
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throwNotFound();
  }

  return id;
}
