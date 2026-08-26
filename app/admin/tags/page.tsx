import { buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { BackLink } from "@/app/components/ui/back-link";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listTagsForAdmin } from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";
import { namespaceLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function AdminTagsPage() {
  const adminUser = await requirePagePermission("/admin/tags", "tag.read_private");
  const [tags, unreadInboxCount] = await Promise.all([listTagsForAdmin(), countUnreadInboxItemsForUser(adminUser)]);

  return (
    <main>
      <PageHeader
        title="标签维护"
        actions={
          <>
            <BackLink href="/admin" label="返回管理端" />
            <Link className={buttonVariants({ variant: "outline" })} href="/tags">
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
                <span className="font-mono text-sm text-primary text-sm text-muted">{tag.slug}</span>
              </td>
              <td>{namespaceLabel(tag.namespace)}</td>
              <td>
                {formatNumber(tag.workCount)} 作品 / {formatNumber(tag.releaseCount)} 发布版本
              </td>
              <td>
                <div className="flex flex-wrap items-center gap-3">
                  <Link className={buttonVariants()} href={`/admin/tags/${tag.id}`}>
                    编辑
                  </Link>
                  {tag.workCount > 0 || tag.releaseCount > 0 ? (
                    <Link
                      className={buttonVariants({ variant: "outline" })}
                      href={`/games?tag=${encodeURIComponent(tag.slug)}`}
                    >
                      查看作品
                    </Link>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </main>
  );
}
