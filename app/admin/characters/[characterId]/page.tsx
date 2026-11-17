import { parsePageId, throwNotFound } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { type LoaderFunctionArgs, type MetaFunction, useLoaderData, useLocation } from "react-router";
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
    locale: runtime.uiLocale,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [loaderData?.character.primaryName || translate(locale, "admin.characterIndex.character"), translate(locale, "admin.characterDetail.title"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};

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
  const t = useMessages();
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
            <BackLink href="/admin/characters" label={t("admin.characterDetail.back")} />
            {CHARACTER_INDEX_PERMISSIONS.some((key) =>
              hasPermission(adminUser, key),
            ) ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                to={`/admin/characters/index?character=${character.id}`}
              >
                {t("admin.characterDetail.editCategory")}
              </Link>
            ) : null}
            {character.workCount > 0 ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                to={`/games?character=${character.id}`}
              >
                {t("admin.characterDetail.viewWorks")}
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
        <TabsList aria-label={t("admin.characterDetail.tabs")}>
          <TabsTrigger value="profile">{t("admin.characterDetail.profile")}</TabsTrigger>
          <TabsTrigger value="materials">{t("character.materials")}</TabsTrigger>
          {canMerge ? <TabsTrigger value="merge">{t("admin.characterDetail.merge")}</TabsTrigger> : null}
        </TabsList>
        {/* 保持编辑器挂载，切换分区不丢失未保存的修改。 */}
        <TabsContent forceMount value="profile" className="data-[state=inactive]:hidden">
          <ConfirmingForm
            action={`/api/admin/characters/${character.id}/update`}
            className="grid gap-4"
            confirmField="merge_target_id"
            errorTitle={t("admin.characterDetail.profileFailed")}
            id={CHARACTER_EDIT_FORM_ID}
            method="post"
            title={t("admin.characterDetail.mergeTitle")}
            description={t("admin.characterDetail.mergeDescription")}
          >
            <input name="character_id" type="hidden" value={character.id} />

            <Pane heading={t("admin.characterDetail.basic")}>
              <fieldset disabled={!canEdit} className="grid gap-4 md:grid-cols-2">
                <FormField
                  controlId="admin-characters-characterId--field-1"
                  label={t("admin.characterList.name")}
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
                  label={t("upload.metadata.originalTitle")}
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
                  hint={t("admin.characterDetail.aliasesHint")}
                  label={t("character.aliasesJa")}
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
                  hint={t("admin.characterDetail.aliasesNoRepeat")}
                  label={t("character.aliasesZh")}
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
                  hint={t("admin.characterDetail.descriptionHint")}
                  label={t("upload.metadata.description")}
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
                {previewDescription ? t("admin.characterDetail.hidePreview") : t("admin.characterDetail.showPreview")}
              </Button>
            </div>
            <section
              aria-label={t("admin.characterDetail.preview")}
              className="whitespace-pre-wrap rounded-lg border border-border bg-card p-4 text-sm leading-relaxed"
              hidden={!previewDescription}
              id="character-description-preview"
            >
              {description.trim() || t("admin.characterDetail.emptyDescription")}
            </section>

            {canEdit ? (
              <StickySaveBar>
                <Button type="submit">{t("admin.characterDetail.saveProfile")}</Button>
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
              {t("admin.characterDetail.materialsWorkbench")}
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
              errorTitle={t("admin.characterDetail.mergeFailed")}
              method="post"
              title={t("admin.characterDetail.mergeTitle")}
              description={t("admin.characterDetail.mergeDescription")}
            >
              <input name="character_id" type="hidden" value={character.id} />
              <Pane heading={t("admin.characterDetail.mergeDuplicates")} tone="danger">
                <FormField
                  controlId="admin-characters-characterId--field-5"
                  hint={t("admin.characterDetail.mergeHint")}
                  hintId="character-merge-target-hint"
                  label={t("admin.characterDetail.target")}
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
                <Button type="submit" variant="destructive">{t("admin.characterDetail.mergeSubmit")}</Button>
              </StickySaveBar>
            </ConfirmingForm>
          </TabsContent>
        ) : null}
      </Tabs>
    </main>
  );
}
