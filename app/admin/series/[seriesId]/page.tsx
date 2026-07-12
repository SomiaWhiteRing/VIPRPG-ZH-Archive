import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
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
  const adminUser = await requireAdminPageUser(`/admin/series/${seriesId}`);
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
        eyebrow="Edit Series"
        title={series.title}
        actions={
          <>
            <BackLink href="/admin/series" label="返回系列维护" />
            {series.status === "published" ? (
              <Link className="button" href={`/series/${series.slug}`}>
                公开页
              </Link>
            ) : null}
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <form
        action={`/api/admin/series/${series.id}/update`}
        className="card form-card stack-form"
        method="post"
      >
        <input name="series_id" type="hidden" value={series.id} />
        <section className="form-section">
          <SectionHeading title="系列资料" />
          <div className="upload-form-grid">
            <FormField hint="不可修改" label="Slug">
              <input readOnly value={series.slug} />
            </FormField>
            <FormField label="系列名">
              <input defaultValue={series.title} name="title" required />
            </FormField>
            <FormField label="原名">
              <input defaultValue={series.titleOriginal ?? ""} name="title_original" />
            </FormField>
            <FormField label="状态">
              <select defaultValue={series.status} name="status">
                <option value="published">已发布</option>
                <option value="hidden">隐藏</option>
                <option value="draft">草稿</option>
                <option value="deleted">已删除</option>
              </select>
            </FormField>
            <FormField label="简介" wide>
              <textarea defaultValue={series.description ?? ""} name="description" rows={6} />
            </FormField>
          </div>
        </section>
        <div className="actions">
          <button className="button primary" type="submit">
            保存系列资料
          </button>
        </div>
      </form>

      <section aria-label="系列成员">
        <p className="muted-line">成员请在作品编辑页维护。</p>
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
                  <span className="muted-line">{work.originalTitle}</span>
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
