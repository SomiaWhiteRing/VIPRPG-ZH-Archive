import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import { Button, buttonVariants } from "@/app/components/ui/button";
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
import { getTagForAdminEdit } from "@/lib/server/db/taxonomy-library";

export const dynamic = "force-dynamic";

type AdminTagEditPageProps = {
  params: Promise<{
    tagId: string;
  }>;
};

export default async function AdminTagEditPage({ params }: AdminTagEditPageProps) {
  const { tagId: rawTagId } = await params;
  const tagId = parseId(rawTagId);
  const adminUser = await requirePagePermission(`/admin/tags/${tagId}`, "tag.update");
  const [tag, unreadInboxCount] = await Promise.all([
    getTagForAdminEdit(tagId),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  if (!tag) {
    notFound();
  }

  return (
    <main>
      <PageHeader
        title={tag.name}
        actions={
          <>
            <BackLink href="/admin/tags" label="返回标签维护" />
            {tag.workCount > 0 || tag.releaseCount > 0 ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`/games?tag=${encodeURIComponent(tag.slug)}`}
              >
                查看作品
              </Link>
            ) : null}
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <ConfirmingForm
        action={`/api/admin/tags/${tag.id}/update`}
        className="grid gap-4 grid gap-4"
        confirmField="merge_target_slug"
        method="post"
        title="确认合并并删除标签"
        description="目标标签会接收现有关联，当前标签将被删除。此操作不可逆，请确认目标 slug 正确。"
      >
        <input name="tag_id" type="hidden" value={tag.id} />
        <Pane heading="基础信息">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField hint="不可修改" label="Slug">
              <Input readOnly value={tag.slug} />
            </FormField>
            <FormField label="名称">
              <Input defaultValue={tag.name} name="name" required />
            </FormField>
            <FormField label="命名空间">
              <SelectField
                defaultValue={tag.namespace}
                name="namespace"
                options={[
                  { value: "genre", label: "类型" },
                  { value: "theme", label: "主题" },
                  { value: "character", label: "角色相关" },
                  { value: "technical", label: "技术" },
                  { value: "content", label: "内容" },
                  { value: "other", label: "其他" },
                ]}
              />
            </FormField>
            <FormField label="描述" wide>
              <Textarea defaultValue={tag.description ?? ""} name="description" rows={6} />
            </FormField>
          </div>
        </Pane>

        <Pane heading="合并重复标签" tone="danger">
          <FormField hint="提交后，作品与发布版本关联会移至目标标签，当前标签会被删除。" label="目标标签 slug">
            <Input name="merge_target_slug" placeholder="留空则不合并" />
          </FormField>
        </Pane>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">保存标签资料</Button>
        </div>
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
