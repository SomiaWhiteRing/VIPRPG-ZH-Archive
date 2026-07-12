import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { getCharacterForAdminEdit } from "@/lib/server/db/taxonomy-library";

export const dynamic = "force-dynamic";

type AdminCharacterEditPageProps = {
  params: Promise<{
    characterId: string;
  }>;
};

export default async function AdminCharacterEditPage({
  params,
}: AdminCharacterEditPageProps) {
  const { characterId: rawCharacterId } = await params;
  const characterId = parseId(rawCharacterId);
  const adminUser = await requireAdminPageUser(`/admin/characters/${characterId}`);
  const [character, unreadInboxCount] = await Promise.all([
    getCharacterForAdminEdit(characterId),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  if (!character) {
    notFound();
  }

  return (
    <main>
      <PageHeader
        eyebrow="Edit Character"
        title={character.primaryName}
        actions={
          <>
            <BackLink href="/admin/characters" label="返回角色维护" />
            {character.workCount > 0 ? (
              <Link className="button" href={`/characters/${character.slug}`}>
                公开页
              </Link>
            ) : null}
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <form
        action={`/api/admin/characters/${character.id}/update`}
        className="stack-form admin-edit-form"
        method="post"
      >
        <input name="character_id" type="hidden" value={character.id} />
        <Pane heading="基础信息">
          <div className="upload-form-grid">
            <FormField hint="不可修改" label="Slug">
              <input readOnly value={character.slug} />
            </FormField>
            <FormField label="名称">
              <input defaultValue={character.primaryName} name="primary_name" required />
            </FormField>
            <FormField label="原名">
              <input defaultValue={character.originalName ?? ""} name="original_name" />
            </FormField>
            <FormField label="简介" wide>
              <textarea defaultValue={character.description ?? ""} name="description" rows={6} />
            </FormField>
          </div>
        </Pane>

        <Pane heading="合并重复角色" tone="danger">
          <FormField
            hint="提交后，登场关系会移至目标角色，当前角色会被删除。"
            label="目标角色 slug"
          >
            <input name="merge_target_slug" placeholder="留空则不合并" />
          </FormField>
        </Pane>

        <div className="actions">
          <button className="button primary" type="submit">
            保存角色资料
          </button>
        </div>
      </form>
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
