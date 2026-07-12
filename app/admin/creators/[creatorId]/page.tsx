import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { getCreatorForAdminEdit } from "@/lib/server/db/creator-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import {
  creatorRoleLabel,
  workStatusLabel,
} from "@/lib/labels";

export const dynamic = "force-dynamic";

type AdminCreatorEditPageProps = {
  params: Promise<{
    creatorId: string;
  }>;
};

export default async function AdminCreatorEditPage({
  params,
}: AdminCreatorEditPageProps) {
  const { creatorId: rawCreatorId } = await params;
  const creatorId = parseCreatorId(rawCreatorId);
  const adminUser = await requireAdminPageUser(`/admin/creators/${creatorId}`);
  const [creator, unreadInboxCount] = await Promise.all([
    getCreatorForAdminEdit(creatorId),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  if (!creator) {
    notFound();
  }

  return (
    <main>
      <PageHeader
        eyebrow="Edit Creator"
        title={creator.name}
        actions={
          <>
            <BackLink href="/admin/creators" label="返回作者维护" />
            <Link className="button" href={`/creators/${creator.slug}`}>
              查看公开页
            </Link>
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <form
        action={`/api/admin/creators/${creator.id}/update`}
        className="stack-form admin-edit-form"
        method="post"
      >
        <input name="creator_id" type="hidden" value={creator.id} />

        <Pane heading="基础信息">
          <div className="upload-form-grid">
            <FormField hint="不可修改" label="Slug">
              <input readOnly value={creator.slug} />
            </FormField>
            <FormField label="名称">
              <input defaultValue={creator.name} name="name" required type="text" />
            </FormField>
            <FormField label="原名">
              <input
                defaultValue={creator.originalName ?? ""}
                name="original_name"
                type="text"
              />
            </FormField>
            <FormField label="个人链接">
              <input
                defaultValue={creator.websiteUrl ?? ""}
                name="website_url"
                type="url"
              />
            </FormField>
            <FormField label="简介" wide>
              <textarea defaultValue={creator.bio ?? ""} name="bio" rows={6} />
            </FormField>
          </div>
        </Pane>

        <div className="actions">
          <button className="button primary" type="submit">
            保存作者资料
          </button>
        </div>
      </form>

      <section className="section-grid admin-creator-credit-grid" aria-label="作者关联">
        <Pane heading="作品层职务">
          {creator.adminWorkCredits.length > 0 ? (
            <ul className="plain-list">
              {creator.adminWorkCredits.map((credit) => (
                <li key={`${credit.workId}-${credit.roleKey}`}>
                  <Link href={`/admin/works/${credit.workId}`}>{credit.workTitle}</Link>
                  <span className="muted-line">
                    {creatorRoleLabel(credit.roleKey)} / {workStatusLabel(credit.status)}
                    {credit.notes ? ` / ${credit.notes}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="暂无作品层职务。" />
          )}
        </Pane>

        <Pane heading="发布版本职务">
          {creator.adminReleaseCredits.length > 0 ? (
            <ul className="plain-list">
              {creator.adminReleaseCredits.map((credit) => (
                <li key={`${credit.releaseId}-${credit.roleKey}`}>
                  <Link href={`/admin/releases/${credit.releaseId}`}>
                    {credit.workTitle} / {credit.releaseLabel}
                  </Link>
                  <span className="muted-line">
                    {creatorRoleLabel(credit.roleKey)} / {workStatusLabel(credit.status)}
                    {credit.notes ? ` / ${credit.notes}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="暂无发布版本职务。" />
          )}
        </Pane>
      </section>
    </main>
  );
}

function parseCreatorId(value: string): number {
  const creatorId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(creatorId) || creatorId <= 0) {
    notFound();
  }

  return creatorId;
}
