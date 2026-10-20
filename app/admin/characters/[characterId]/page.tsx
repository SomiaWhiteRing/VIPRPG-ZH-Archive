import { parsePageId, throwNotFound } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { type LoaderFunctionArgs, type MetaFunction, useLoaderData, useLocation, Link } from "react-router";
import { useEffect, useState } from "react";


import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { readCharacterIndex } from "@/app/.server/db/character-index";
import { getCharacterPortraitLibraryForAdmin } from "@/app/.server/db/character-portrait-library";
import {
  getCharacterForAdminEdit,
  listCharactersForAdmin,
} from "@/app/.server/db/taxonomy-library";

import { StickySaveBar } from "@/app/admin/admin-list-controls";
import { BackLink } from "@/app/components/ui/back-link";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { Textarea } from "@/app/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import {
  CHARACTER_DETAIL_PERMISSIONS,
  CHARACTER_INDEX_PERMISSIONS,
  hasPermission,
} from "@/lib/authz/permissions";

import { CharacterMergeTargetField } from "./character-merge-target-field";
import { PortraitLibraryEditor } from "./portrait-library-editor";

const CHARACTER_EDIT_FORM_ID = "character-edit-form";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const { characterId: rawCharacterId } = await params;
  const characterId = parsePageId(rawCharacterId);
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

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    {
      title: [loaderData?.character.primaryName || "角色", "角色维护", "控制台"],
    },
    error,
  );

export default function AdminCharacterEditPage() {
  const data = useLoaderData<typeof loader>();
  return <CharacterEditPage key={data.character.id} {...data} />;
}

function CharacterEditPage({
  adminUser,
  canEdit,
  canMerge,
  canManagePortrait,
  canUploadPortrait,
  character,
  candidates,
  portraitLibrary,
  characterIndex,
}: Awaited<ReturnType<typeof loader>>) {
  const { hash } = useLocation();
  const [tab, setTab] = useState("profile");
  const [description, setDescription] = useState(character.description ?? "");
  const [previewDescription, setPreviewDescription] = useState(false);
  useEffect(() => {
    setTab(hash === "#portrait-workbench" ? "materials" : "profile");
  }, [hash]);
  return (
    <main>
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

      <RedirectFeedback />

      <div className="flex items-center gap-3 text-sm text-muted">
        <CharacterPortrait displayName={character.primaryName} portrait={character.defaultPortrait} size={48} />
        <div>
          <p className="m-0 text-foreground" lang="ja">{character.originalName}</p>
          <span>#{character.id}</span>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="角色编辑分区">
          <TabsTrigger value="profile">资料</TabsTrigger>
          <TabsTrigger value="materials">素材</TabsTrigger>
          {canMerge ? <TabsTrigger value="merge">合并</TabsTrigger> : null}
        </TabsList>
        {/* 保持编辑器挂载，切换分区不丢失未保存的修改。 */}
        <TabsContent forceMount value="profile" className="data-[state=inactive]:hidden">
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
                <FormField
                  controlId="character-description"
                  hint="介绍角色的背景、特点与常见形象。支持换行。"
                  label="简介"
                  wide
                >
                  <Textarea
                    aria-describedby="character-description-hint"
                    id="character-description"
                    name="description"
                    rows={6}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </FormField>
              </fieldset>
            </Pane>

            <div>
              <Button
                aria-controls="character-description-preview"
                aria-expanded={previewDescription}
                onClick={() => setPreviewDescription(!previewDescription)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {previewDescription ? "收起预览" : "预览简介"}
              </Button>
            </div>
            <section
              aria-label="简介预览"
              className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm leading-relaxed"
              hidden={!previewDescription}
              id="character-description-preview"
            >
              {description.trim() || "暂无简介。"}
            </section>

            {canEdit ? (
              <StickySaveBar>
                <Button type="submit">保存角色资料</Button>
              </StickySaveBar>
            ) : null}
          </ConfirmingForm>
        </TabsContent>

        <TabsContent forceMount value="materials" className="data-[state=inactive]:hidden">
          <section
            id="portrait-workbench"
            className="min-w-0"
            aria-labelledby="material-workbench-heading"
          >
            <h2 id="material-workbench-heading" className="mb-4 text-lg font-bold">
              素材工作台
            </h2>
            <PortraitLibraryEditor
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
        </TabsContent>

        {canMerge ? (
          <TabsContent forceMount value="merge" className="data-[state=inactive]:hidden">
            <ConfirmingForm
              action={`/api/admin/characters/${character.id}/update`}
              className="grid gap-4"
              confirmField="merge_target_id"
              errorTitle="角色合并失败"
              method="post"
              title="确认合并并删除角色"
              description="目标角色会接收现有关联，当前角色将被删除。此操作不可逆，请确认目标名称正确。"
            >
              <input name="character_id" type="hidden" value={character.id} />
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
              <StickySaveBar>
                <Button type="submit" variant="destructive">合并角色</Button>
              </StickySaveBar>
            </ConfirmingForm>
          </TabsContent>
        ) : null}
      </Tabs>
    </main>
  );
}
