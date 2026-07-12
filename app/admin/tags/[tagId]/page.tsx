import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
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
  const adminUser = await requireAdminPageUser(`/admin/tags/${tagId}`);
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
        eyebrow="Edit Tag"
        title={tag.name}
        actions={
          <>
            <BackLink href="/admin/tags" label="返回标签维护" />
            <Link className="button" href={`/tags/${tag.slug}`}>
              公开页
            </Link>
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <form
        action={`/api/admin/tags/${tag.id}/update`}
        className="card form-card stack-form"
        method="post"
      >
        <input name="tag_id" type="hidden" value={tag.id} />
        <section className="form-section">
          <SectionHeading title="标签资料" />
          <div className="upload-form-grid">
            <FormField hint="不可修改" label="Slug">
              <input readOnly value={tag.slug} />
            </FormField>
            <FormField label="名称">
              <input defaultValue={tag.name} name="name" required />
            </FormField>
            <FormField label="命名空间">
              <select defaultValue={tag.namespace} name="namespace">
                <option value="genre">类型</option>
                <option value="theme">主题</option>
                <option value="character">角色相关</option>
                <option value="technical">技术</option>
                <option value="content">内容</option>
                <option value="other">其他</option>
              </select>
            </FormField>
            <FormField label="描述" wide>
              <textarea defaultValue={tag.description ?? ""} name="description" rows={6} />
            </FormField>
          </div>
        </section>

        <section className="form-section">
          <SectionHeading title="合并重复标签" />
          <FormField
            hint="提交后，作品与发布版本关联会移至目标标签，当前标签会被删除。"
            label="目标标签 slug"
          >
            <input name="merge_target_slug" placeholder="留空则不合并" />
          </FormField>
        </section>

        <div className="actions">
          <button className="button primary" type="submit">
            保存标签资料
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
