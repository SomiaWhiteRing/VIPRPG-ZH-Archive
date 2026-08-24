import { buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { BackLink } from "@/app/components/ui/back-link";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { listCreatorsForAdmin } from "@/lib/server/db/creator-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminCreatorsPage() {
  const adminUser = await requirePagePermission("/admin/creators", "creator.read_private");
  const [creators, unreadInboxCount] = await Promise.all([
    listCreatorsForAdmin(),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <PageHeader
        eyebrow="Admin Creators"
        title="作者与制作人员维护"
        actions={
          <>
            <BackLink href="/admin" label="返回管理端" />
            <Link className={buttonVariants({ variant: "outline" })} href="/creators">
              查看公开列表
            </Link>
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <TableWrap label="作者列表" minWidth={900}>
        <thead>
          <tr>
            <th>作者</th>
            <th>关联</th>
            <th>链接</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {creators.map((creator) => (
            <tr key={creator.id}>
              <td>
                <strong>{creator.name}</strong>
                {creator.originalName ? <span className="text-sm text-muted">{creator.originalName}</span> : null}
                <span className="font-mono text-sm text-primary text-sm text-muted">{creator.slug}</span>
              </td>
              <td>
                {formatNumber(creator.workCreditCount)} 作品 / {formatNumber(creator.releaseCreditCount)} 发布版本
                {creator.latestReleaseCreditAt ? (
                  <span className="text-sm text-muted">最近关联：{creator.latestReleaseCreditAt}</span>
                ) : null}
              </td>
              <td>
                {creator.websiteUrl ? (
                  <a href={creator.websiteUrl} rel="noreferrer" target="_blank">
                    个人链接
                  </a>
                ) : (
                  <span className="text-sm text-muted">未填写</span>
                )}
              </td>
              <td>
                <div className="flex flex-wrap items-center gap-3">
                  <Link className={buttonVariants()} href={`/admin/creators/${creator.id}`}>
                    编辑
                  </Link>
                  <Link className={buttonVariants({ variant: "outline" })} href={`/creators/${creator.slug}`}>
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
