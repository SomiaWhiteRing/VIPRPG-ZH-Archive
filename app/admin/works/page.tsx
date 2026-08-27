import { buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { BackLink } from "@/app/components/ui/back-link";
import { ChipList } from "@/app/components/ui/chip-list";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { listEditableWorksForAdmin } from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatNumber, formatBytes } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminWorksPage() {
  const adminUser = await requirePagePermission("/admin/works", "work.read_private");
  const [works, unreadInboxCount] = await Promise.all([
    listEditableWorksForAdmin(200),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <PageHeader
        title="作品资料维护"
        actions={
          <>
            <BackLink href="/admin" label="返回管理端" />
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <TableWrap label="作品列表" minWidth={980}>
        <thead>
          <tr>
            <th>作品</th>
            <th>状态</th>
            <th>规模</th>
            <th>标签</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {works.map((work) => (
            <tr key={work.id}>
              <td>
                <strong>{work.chineseTitle || work.originalTitle}</strong>
                {work.chineseTitle ? <span className="text-sm text-muted">{work.originalTitle}</span> : null}
                <span className="font-mono text-sm text-primary text-sm text-muted">{work.slug}</span>
              </td>
              <td>
                <StatusBadge kind="publication" value={work.status} />
                {work.usesManiacsPatch ? <span className="text-sm text-muted">Maniacs Patch</span> : null}
              </td>
              <td>
                {formatNumber(work.archiveVersionCount)} 个归档快照
                <span className="text-sm text-muted">{formatBytes(work.totalSizeBytes)}</span>
              </td>
              <td>
                {work.tags.length > 0 ? (
                  <ChipList compact items={work.tags.slice(0, 6).map((tag) => ({ label: tag.name }))} />
                ) : (
                  <span className="text-sm text-muted">未填写</span>
                )}
              </td>
              <td>
                <div className="flex flex-wrap items-center gap-3">
                  <Link className={buttonVariants()} href={`/admin/works/${work.id}`}>
                    编辑
                  </Link>
                  {work.status === "published" ? (
                    <Link className={buttonVariants({ variant: "outline" })} href={`/games/${work.slug}`}>
                      查看公开页
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
