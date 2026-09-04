import { Input } from "@/app/components/ui/input";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { PortraitLibraryEditor } from "./portrait-library-editor";
import { CharacterMergeTargetField } from "./character-merge-target-field";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { Textarea } from "@/app/components/ui/textarea";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { getCharacterForAdminEdit, listCharactersForAdmin } from "@/lib/server/db/taxonomy-library";
import { getCharacterPortraitLibraryForAdmin } from "@/lib/server/db/character-portrait-library";
import { StickySaveBar } from "@/app/admin/admin-list-controls";

export const dynamic = "force-dynamic";
const CHARACTER_EDIT_FORM_ID = "character-edit-form";

type AdminCharacterEditPageProps = {
  params: Promise<{
    characterId: string;
  }>;
  searchParams: Promise<{
    error?: string | string[];
  }>;
};

export default async function AdminCharacterEditPage({ params, searchParams }: AdminCharacterEditPageProps) {
  const { characterId: rawCharacterId } = await params;
  const query = await searchParams;
  const formError = Array.isArray(query.error) ? query.error[0] : query.error;
  const characterId = parseId(rawCharacterId);
  const adminUser = await requirePagePermission(`/admin/characters/${characterId}`, "character.update");
  const [character, unreadInboxCount, candidates, portraitLibrary] = await Promise.all([
    getCharacterForAdminEdit(characterId),
    countUnreadInboxItemsForUser(adminUser),
    listCharactersForAdmin(2000),
    getCharacterPortraitLibraryForAdmin(characterId),
  ]);

  if (!character) {
    notFound();
  }

  return (
    <main>
      <PageHeader
        compact
        title={character.primaryName}
        actions={
          <>
            <BackLink href="/admin/characters" label="返回角色维护" />
            {character.workCount > 0 ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`/games?character=${character.id}`}
              >
                查看作品
              </Link>
            ) : null}
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      {formError ? (
        <p className="mb-4 border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
          {formError}
        </p>
      ) : null}

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
        <div id="portrait-workbench">
          <Pane compact heading="脸图工作台">
            <PortraitLibraryEditor
              allCharacters={candidates.map((candidate) => ({
                id: candidate.id,
                originalName: candidate.originalName,
                primaryName: candidate.primaryName,
              }))}
              allSheets={portraitLibrary.sheets}
              characterId={character.id}
              characterName={character.primaryName}
              characterOriginalName={character.originalName}
              defaultPortrait={portraitLibrary.defaultPortrait}
              initialBoundSheetIds={portraitLibrary.boundSheetIds}
            />
          </Pane>
        </div>

        <Pane heading="基础信息">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="名称">
              <Input defaultValue={character.primaryName} name="primary_name" required />
            </FormField>
            <FormField label="原名">
              <Input defaultValue={character.originalName} name="original_name" required />
            </FormField>
            <FormField label="简介" wide>
              <Textarea defaultValue={character.description ?? ""} name="description" rows={6} />
            </FormField>
            <FormField hint="每行一个；可添加、修改或删除。" label="日文别名">
              <Textarea
                defaultValue={character.aliases.filter((alias) => alias.language === "ja").map((alias) => alias.name).join("\n")}
                name="japanese_aliases"
                rows={5}
              />
            </FormField>
            <FormField hint="每行一个；角色名称本身不必重复填写。" label="中文别名">
              <Textarea
                defaultValue={character.aliases.filter((alias) => alias.language === "zh").map((alias) => alias.name).join("\n")}
                name="chinese_aliases"
                rows={5}
              />
            </FormField>
          </div>
        </Pane>

        <Pane heading="合并重复角色" tone="danger">
          <FormField hint="提交后，登场关系会移至目标角色，当前角色会被删除。" hintId="character-merge-target-hint" label="目标角色">
            <CharacterMergeTargetField
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
          <Button type="submit">保存角色资料</Button>
        </StickySaveBar>
      </ConfirmingForm>
    </main>
  );
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    notFound();
  }

  return id;
}
