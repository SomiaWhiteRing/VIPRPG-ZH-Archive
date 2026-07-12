import Link from "next/link";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listSeriesForAdmin } from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminSeriesPage() {
  const adminUser = await requireAdminPageUser("/admin/series");
  const [series, unreadInboxCount] = await Promise.all([
    listSeriesForAdmin(),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  return (
    <main>
      <PageHeader
        eyebrow="Admin Series"
        title="系列作品维护"
        actions={
          <>
            <BackLink href="/admin" label="返回管理端" />
            <Link className="button" href="/series">
              公开列表
            </Link>
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <form
        action="/api/admin/series/create"
        className="card form-card stack-form"
        method="post"
      >
        <section className="form-section">
          <SectionHeading title="新建系列" />
          <div className="upload-form-grid">
            <FormField label="系列名">
              <input name="title" required />
            </FormField>
            <FormField label="原名">
              <input name="title_original" />
            </FormField>
            <FormField label="Slug">
              <input name="slug" placeholder="留空自动生成" />
            </FormField>
          </div>
        </section>
        <div className="actions">
          <button className="button primary" type="submit">
            创建系列
          </button>
        </div>
      </form>

      <TableWrap label="系列列表" minWidth={900}>
          <thead>
            <tr>
              <th>系列</th>
              <th>状态</th>
              <th>作品</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {series.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.title}</strong>
                  {item.titleOriginal ? (
                    <span className="muted-line">{item.titleOriginal}</span>
                  ) : null}
                  <span className="mono muted-line">{item.slug}</span>
                </td>
                <td>
                  <StatusBadge kind="publication" value={item.status} />
                </td>
                <td>{formatNumber(item.workCount)}</td>
                <td>
                  <div className="actions compact-actions">
                    <Link className="button primary" href={`/admin/series/${item.id}`}>
                      编辑
                    </Link>
                    {item.status === "published" ? (
                      <Link className="button" href={`/series/${item.slug}`}>
                        公开页
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
