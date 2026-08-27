import { Input } from "@/app/components/ui/input";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { getCreatorForAdminEdit } from "@/lib/server/db/creator-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { creatorRoleLabel, workStatusLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

type AdminCreatorEditPageProps = {
  params: Promise<{
    creatorId: string;
  }>;
};

export default async function AdminCreatorEditPage({ params }: AdminCreatorEditPageProps) {
  const { creatorId: rawCreatorId } = await params;
  const creatorId = parseCreatorId(rawCreatorId);
  const adminUser = await requirePagePermission(`/admin/creators/${creatorId}`, "creator.update");
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
        title={creator.name}
        actions={
          <>
            <BackLink href="/admin/creators" label="返回作者维护" />
            <Link className={buttonVariants({ variant: "outline" })} href={`/creators/${creator.slug}`}>
              查看公开页
            </Link>
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <form action={`/api/admin/creators/${creator.id}/update`} className="grid gap-4 grid gap-4" method="post">
        <input name="creator_id" type="hidden" value={creator.id} />

        <Pane heading="基础信息">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField hint="不可修改" label="Slug">
              <Input readOnly value={creator.slug} />
            </FormField>
            <FormField label="名称">
              <Input defaultValue={creator.name} name="name" required type="text" />
            </FormField>
            <FormField label="原名">
              <Input defaultValue={creator.originalName ?? ""} name="original_name" type="text" />
            </FormField>
            <FormField label="个人链接">
              <Input defaultValue={creator.websiteUrl ?? ""} name="website_url" type="url" />
            </FormField>
            <FormField label="简介" wide>
              <Textarea defaultValue={creator.bio ?? ""} name="bio" rows={6} />
            </FormField>
          </div>
        </Pane>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">保存作者资料</Button>
        </div>
      </form>

      <section className="grid gap-3 md:grid-cols-3 grid gap-4 lg:grid-cols-2" aria-label="作者关联">
        <Pane heading="作品层职务">
          {creator.adminWorkCredits.length > 0 ? (
            <ul className="mt-3 grid gap-3">
              {creator.adminWorkCredits.map((credit) => (
                <li key={`${credit.workId}-${credit.roleKey}`}>
                  <Link href={`/admin/works/${credit.workId}`}>{credit.workTitle}</Link>
                  <span className="text-sm text-muted">
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
