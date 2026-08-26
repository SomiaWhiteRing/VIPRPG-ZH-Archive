import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { getSeriesForAdminEdit } from "@/lib/server/db/taxonomy-library";

export const dynamic = "force-dynamic";

type AdminSeriesEditPageProps = {
  params: Promise<{
    seriesId: string;
  }>;
};

export default async function AdminSeriesEditPage({ params }: AdminSeriesEditPageProps) {
  const { seriesId: rawSeriesId } = await params;
  const seriesId = parseId(rawSeriesId);
  const adminUser = await requirePagePermission(`/admin/series/${seriesId}`, "series.update");
  const [series, unreadInboxCount] = await Promise.all([
    getSeriesForAdminEdit(seriesId),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  if (!series) {
    notFound();
  }

  return (
    <main>
      <PageHeader
        title={series.title}
        actions={
          <>
            <BackLink href="/admin/series" label="返回系列维护" />
            {series.status === "published" ? (
              <Link className={buttonVariants({ variant: "outline" })} href={`/series/${series.slug}`}>
                公开页
              </Link>
            ) : null}
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <form action={`/api/admin/series/${series.id}/update`} className="grid gap-4 grid gap-4" method="post">
        <input name="series_id" type="hidden" value={series.id} />
        <Pane heading="基础信息">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField hint="不可修改" label="Slug">
              <Input readOnly value={series.slug} />
            </FormField>
            <FormField label="系列名">
              <Input defaultValue={series.title} name="title" required />
            </FormField>
            <FormField label="原名">
              <Input defaultValue={series.titleOriginal ?? ""} name="title_original" />
            </FormField>
            <FormField label="简介" wide>
              <Textarea defaultValue={series.description ?? ""} name="description" rows={6} />
            </FormField>
          </div>
        </Pane>
        <Pane heading="发布与删除状态" tone="danger">
          <FormField hint="选择“已删除”后保存会将系列标记为删除；提交前请再次核对。" label="状态">
            <SelectField
              defaultValue={series.status}
              name="status"
              options={[
                { value: "published", label: "已发布" },
                { value: "hidden", label: "隐藏" },
                { value: "draft", label: "草稿" },
                { value: "deleted", label: "已删除" },
              ]}
            />
          </FormField>
        </Pane>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">保存系列资料</Button>
        </div>
      </form>

      <section aria-label="系列成员">
        <p className="text-sm text-muted">成员请在作品编辑页维护。</p>
        <TableWrap compact label="系列成员" minWidth={760}>
          <thead>
            <tr>
              <th>顺序</th>
              <th>作品</th>
              <th>关系</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {series.works.map((work) => (
              <tr key={work.workId}>
                <td>{work.positionLabel || work.positionNumber || "-"}</td>
                <td>
                  <Link href={`/admin/works/${work.workId}`}>{work.title}</Link>
                  <span className="text-sm text-muted">{work.originalTitle}</span>
                </td>
                <td>{seriesRelationLabel(work.relationKind)}</td>
                <td>
                  <StatusBadge kind="publication" value={work.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>
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

function seriesRelationLabel(value: string): string {
  const labels: Record<string, string> = {
    main: "正篇",
    side: "外传",
    collection_member: "合集成员",
    same_setting: "同世界观",
    other: "其他",
  };

  return labels[value] ?? value;
}
