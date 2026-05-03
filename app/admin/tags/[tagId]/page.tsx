import Link from "next/link";
import { notFound } from "next/navigation";
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
      <header className="page-header">
        <div>
          <p className="eyebrow">Edit Tag</p>
          <h1>{tag.name}</h1>
          <p className="subtitle">标签 slug 暂不修改；重复项通过合并到目标 slug 处理。</p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin/tags">
            返回标签维护
          </Link>
          <Link className="button" href={`/tags/${tag.slug}`}>
            公开页
          </Link>
          <Link className="button" href="/inbox">
            站内信
            {unreadInboxCount > 0 ? (
              <span className="notification-badge">
                {formatUnreadCount(unreadInboxCount)}
              </span>
            ) : null}
          </Link>
        </div>
      </header>

      <form
        action={`/api/admin/tags/${tag.id}/update`}
        className="card form-card stack-form"
        method="post"
      >
        <input name="tag_id" type="hidden" value={tag.id} />
        <section className="form-section">
          <h2>标签资料</h2>
          <div className="upload-form-grid">
            <label className="field">
              Slug
              <input readOnly value={tag.slug} />
            </label>
            <label className="field">
              名称
              <input defaultValue={tag.name} name="name" required />
            </label>
            <label className="field">
              命名空间
              <select defaultValue={tag.namespace} name="namespace">
                <option value="genre">类型</option>
                <option value="theme">主题</option>
                <option value="character">角色相关</option>
                <option value="technical">技术</option>
                <option value="content">内容</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label className="field wide-field">
              描述
              <textarea defaultValue={tag.description ?? ""} name="description" rows={6} />
            </label>
          </div>
        </section>

        <section className="form-section">
          <h2>合并重复标签</h2>
          <label className="field">
            目标标签 slug
            <input name="merge_target_slug" placeholder="留空则不合并" />
            <span className="muted-line">
              提交后当前标签的 Work/Release 关联会移动到目标标签，当前标签记录会被删除。
            </span>
          </label>
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

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
