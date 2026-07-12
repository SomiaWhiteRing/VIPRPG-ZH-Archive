import Link from "next/link";
import { BackLink } from "@/app/components/ui/back-link";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listTagsForAdmin } from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";
import { namespaceLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function AdminTagsPage() {
  const adminUser = await requireAdminPageUser("/admin/tags");
  const [tags, unreadInboxCount] = await Promise.all([
    listTagsForAdmin(),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <PageHeader
        eyebrow="Admin Tags"
        title="标签维护"
        actions={
          <>
            <BackLink href="/admin" label="返回管理端" />
            <Link className="button" href="/tags">
              公开列表
            </Link>
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <TableWrap label="标签列表" minWidth={900}>
          <thead>
            <tr>
              <th>标签</th>
              <th>命名空间</th>
              <th>关联</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {tags.map((tag) => (
              <tr key={tag.id}>
                <td>
                  <strong>{tag.name}</strong>
                  <span className="mono muted-line">{tag.slug}</span>
                </td>
                <td>{namespaceLabel(tag.namespace)}</td>
                <td>
                  {formatNumber(tag.workCount)} 作品 / {formatNumber(tag.releaseCount)} 发布版本
                </td>
                <td>
                  <div className="actions compact-actions">
                    <Link className="button primary" href={`/admin/tags/${tag.id}`}>
                      编辑
                    </Link>
                    <Link className="button" href={`/tags/${tag.slug}`}>
                      公开页
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
      </TableWrap>
    </main>
  );
}
