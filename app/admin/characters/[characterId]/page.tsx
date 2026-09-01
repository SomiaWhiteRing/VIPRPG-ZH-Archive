import { Input } from "@/app/components/ui/input";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { Textarea } from "@/app/components/ui/textarea";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { SelectField } from "@/app/components/ui/select";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { getCharacterForAdminEdit, listCharactersForAdmin } from "@/lib/server/db/taxonomy-library";
import { StickySaveBar } from "@/app/admin/admin-list-controls";

export const dynamic = "force-dynamic";

type AdminCharacterEditPageProps = {
  params: Promise<{
    characterId: string;
  }>;
};

export default async function AdminCharacterEditPage({ params }: AdminCharacterEditPageProps) {
  const { characterId: rawCharacterId } = await params;
  const characterId = parseId(rawCharacterId);
  const adminUser = await requirePagePermission(`/admin/characters/${characterId}`, "character.update");
  const [character, unreadInboxCount, candidates] = await Promise.all([
    getCharacterForAdminEdit(characterId),
    countUnreadInboxItemsForUser(adminUser),
    listCharactersForAdmin(),
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

      <ConfirmingForm
        action={`/api/admin/characters/${character.id}/update`}
        className="grid gap-4 grid gap-4"
        confirmField="merge_target_id"
        encType="multipart/form-data"
        method="post"
        title="确认合并并删除角色"
        description="目标角色会接收现有关联，当前角色将被删除。此操作不可逆，请确认目标名称正确。"
      >
        <input name="character_id" type="hidden" value={character.id} />
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
            <FormField
              hint="只接受精确 48×48、最多 256 KiB 的 PNG；不选择文件会保留当前头像。"
              label="头像"
              wide
            >
              <div className="flex flex-wrap items-center gap-3">
                <CharacterPortrait
                  className="size-20 text-xl"
                  displayName={character.primaryName}
                  portraitBlobSha256={character.portraitBlobSha256}
                  size={80}
                  toneKey={character.id}
                />
                <Input accept="image/png" name="portrait" type="file" />
              </div>
            </FormField>
          </div>
        </Pane>

        <Pane heading="合并重复角色" tone="danger">
          <FormField hint="提交后，登场关系会移至目标角色，当前角色会被删除。" label="目标角色">
            <SelectField
              name="merge_target_id"
              options={[
                { value: "", label: "不合并" },
                ...candidates
                  .filter((candidate) => candidate.id !== character.id)
                  .map((candidate) => ({
                    value: String(candidate.id),
                    label: `${candidate.originalName} · ${candidate.primaryName}`,
                  })),
              ]}
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
