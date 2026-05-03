import Link from "next/link";
import { notFound } from "next/navigation";
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
      <header className="page-header">
        <div>
          <p className="eyebrow">Edit Series</p>
          <h1>{series.title}</h1>
          <p className="subtitle">系列 slug 暂不修改；系列成员在各作品编辑页维护。</p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin/series">
            返回系列维护
          </Link>
          {series.status === "published" ? (
            <Link className="button" href={`/series/${series.slug}`}>
              公开页
            </Link>
          ) : null}
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
        action={`/api/admin/series/${series.id}/update`}
        className="card form-card stack-form"
        method="post"
      >
        <input name="series_id" type="hidden" value={series.id} />
        <section className="form-section">
          <h2>系列资料</h2>
          <div className="upload-form-grid">
            <label className="field">
              Slug
              <input readOnly value={series.slug} />
            </label>
            <label className="field">
              系列名
              <input defaultValue={series.title} name="title" required />
            </label>
            <label className="field">
              原名
              <input defaultValue={series.titleOriginal ?? ""} name="title_original" />
            </label>
            <label className="field">
              状态
              <select defaultValue={series.status} name="status">
                <option value="published">已发布</option>
                <option value="hidden">隐藏</option>
                <option value="draft">草稿</option>
                <option value="deleted">已删除</option>
              </select>
            </label>
            <label className="field wide-field">
              简介
              <textarea defaultValue={series.description ?? ""} name="description" rows={6} />
            </label>
          </div>
        </section>
        <div className="actions">
          <button className="button primary" type="submit">
            保存系列资料
          </button>
        </div>
      </form>

      <section className="table-wrap admin-related-table" aria-label="系列成员">
        <table className="data-table creator-credit-table">
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
                <td>{statusLabel(work.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

function statusLabel(value: string): string {
  switch (value) {
    case "published":
      return "已发布";
    case "hidden":
      return "隐藏";
    case "draft":
      return "草稿";
    case "deleted":
      return "已删除";
    default:
      return value;
  }
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}
