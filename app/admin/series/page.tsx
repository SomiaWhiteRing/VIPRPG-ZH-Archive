import { Input } from "@/app/components/ui/input";
import { Button, buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { listSeriesForAdmin } from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminSeriesPage() {
  const adminUser = await requirePagePermission("/admin/series", "series.read_private");
  const [series, unreadInboxCount] = await Promise.all([listSeriesForAdmin(), countUnreadInboxItemsForUser(adminUser)]);

  return (
    <main>
      <PageHeader
        eyebrow="Admin Series"
        title="系列作品维护"
        actions={
          <>
            <BackLink href="/admin" label="返回管理端" />
            <Link className={buttonVariants({ variant: "outline" })} href="/series">
              公开列表
            </Link>
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <form
        action="/api/admin/series/create"
        className="rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm min-h-0 grid gap-4"
        method="post"
      >
        <section className="grid gap-3">
          <SectionHeading title="新建系列" />
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="系列名">
              <Input name="title" required />
            </FormField>
            <FormField label="原名">
              <Input name="title_original" />
            </FormField>
            <FormField label="Slug">
              <Input name="slug" placeholder="留空自动生成" />
            </FormField>
          </div>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">创建系列</Button>
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
                {item.titleOriginal ? <span className="text-sm text-muted">{item.titleOriginal}</span> : null}
                <span className="font-mono text-sm text-primary text-sm text-muted">{item.slug}</span>
              </td>
              <td>
                <StatusBadge kind="publication" value={item.status} />
              </td>
              <td>{formatNumber(item.workCount)}</td>
              <td>
                <div className="flex flex-wrap items-center gap-3">
                  <Link className={buttonVariants()} href={`/admin/series/${item.id}`}>
                    编辑
                  </Link>
                  {item.status === "published" ? (
                    <Link className={buttonVariants({ variant: "outline" })} href={`/series/${item.slug}`}>
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
