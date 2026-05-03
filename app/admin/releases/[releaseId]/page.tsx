import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { getReleaseForAdminEdit } from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";

export const dynamic = "force-dynamic";

type AdminReleaseEditPageProps = {
  params: Promise<{
    releaseId: string;
  }>;
};

export default async function AdminReleaseEditPage({
  params,
}: AdminReleaseEditPageProps) {
  const { releaseId: rawReleaseId } = await params;
  const releaseId = parseReleaseId(rawReleaseId);
  const adminUser = await requireAdminPageUser(`/admin/releases/${releaseId}`);
  const [release, unreadInboxCount] = await Promise.all([
    getReleaseForAdminEdit(releaseId),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  if (!release) {
    notFound();
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Edit Release</p>
          <h1>{release.label}</h1>
          <p className="subtitle">
            所属作品：{release.workTitle}。Release key 暂不在这里修改，避免破坏导入识别。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href={`/admin/works/${release.workId}`}>
            返回作品资料
          </Link>
          <Link className="button" href={`/games/${release.workSlug}`}>
            查看公开页
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
        action={`/api/admin/releases/${release.id}/update`}
        className="card form-card stack-form"
        method="post"
      >
        <input name="release_id" type="hidden" value={release.id} />

        <section className="form-section">
          <h2>发布版本资料</h2>
          <div className="upload-form-grid">
            <label className="field">
              Release key
              <input readOnly value={release.key} />
            </label>
            <label className="field">
              Release 名称
              <input
                defaultValue={release.label}
                name="release_label"
                required
                type="text"
              />
            </label>
            <label className="field">
              基底版本
              <select defaultValue={release.baseVariant} name="base_variant">
                <option value="original">原版</option>
                <option value="remake">重制版</option>
                <option value="other">其他基底</option>
              </select>
            </label>
            <label className="field">
              分支标签
              <input
                defaultValue={release.variantLabel}
                name="variant_label"
                required
                type="text"
              />
            </label>
            <label className="field">
              Release 类型
              <select defaultValue={release.type} name="release_type">
                <option value="original">原始发布</option>
                <option value="translation">汉化版</option>
                <option value="revision">修正版</option>
                <option value="localized_revision">本地化修正版</option>
                <option value="demo">试玩版</option>
                <option value="event_submission">活动投稿</option>
                <option value="patch_applied_full_release">补丁整合版</option>
                <option value="repack">重打包</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label className="field">
              状态
              <select defaultValue={release.status} name="status">
                <option value="published">已发布</option>
                <option value="hidden">隐藏</option>
                <option value="draft">草稿</option>
              </select>
            </label>
            <label className="field">
              发布日期
              <input
                defaultValue={release.releaseDate ?? ""}
                name="release_date"
                placeholder="YYYY-MM-DD / YYYY-MM / YYYY"
                type="text"
              />
            </label>
            <label className="field">
              日期精度
              <select
                defaultValue={release.releaseDatePrecision}
                name="release_date_precision"
              >
                <option value="unknown">未知</option>
                <option value="year">年</option>
                <option value="month">月</option>
                <option value="day">日</option>
              </select>
            </label>
            <label className="field">
              来源名称
              <input defaultValue={release.sourceName ?? ""} name="source_name" type="text" />
            </label>
            <label className="field">
              来源链接
              <input defaultValue={release.sourceUrl ?? ""} name="source_url" type="url" />
            </label>
            <label className="field">
              可执行入口
              <input
                defaultValue={release.executablePath ?? ""}
                name="executable_path"
                placeholder="RPG_RT.exe"
                type="text"
              />
            </label>
            <label className="field">
              标签
              <textarea defaultValue={release.tags.join("\n")} name="tags" rows={5} />
              <span className="muted-line">每行一个，或使用逗号分隔。</span>
            </label>
            <label className="field wide-field">
              版权/授权备注
              <textarea
                defaultValue={release.rightsNotes ?? ""}
                name="rights_notes"
                rows={4}
              />
            </label>
            <label className="field wide-field">
              外部链接
              <textarea
                defaultValue={release.externalLinks
                  .map((link) => `${link.label}|${link.url}|${link.linkType}`)
                  .join("\n")}
                name="external_links"
                rows={5}
              />
              <span className="muted-line">
                每行一个：标题|URL|类型。类型可用 official / source / download_page / patch_note / other。
              </span>
            </label>
          </div>
        </section>

        <div className="actions">
          <button className="button primary" type="submit">
            保存 Release
          </button>
        </div>
      </form>

      <section className="table-wrap admin-related-table" aria-label="归档快照">
        <table className="data-table">
          <thead>
            <tr>
              <th>归档</th>
              <th>状态</th>
              <th>规模</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {release.archiveVersions.map((archive) => (
              <tr key={archive.id}>
                <td>
                  <strong>{archive.archiveLabel}</strong>
                  <span className="mono muted-line">
                    #{archive.id} {archive.archiveKey} / {archive.language}
                  </span>
                  {archive.uploaderName ? (
                    <span className="muted-line">上传者：{archive.uploaderName}</span>
                  ) : null}
                </td>
                <td>
                  <span className={`badge ${statusBadgeClass(archive.status)}`}>
                    {statusLabel(archive.status)}
                  </span>
                  {archive.isCurrent ? <span className="muted-line">当前版本</span> : null}
                  <span className="muted-line">
                    {archive.isProofread ? "已校对" : "未校对"} /{" "}
                    {archive.isImageEdited ? "已修图" : "未修图"}
                  </span>
                </td>
                <td>
                  {formatNumber(archive.totalFiles)} 文件
                  <span className="muted-line">{formatBytes(archive.totalSizeBytes)}</span>
                </td>
                <td>
                  <Link className="button primary" href={`/admin/archive-versions/${archive.id}`}>
                    编辑
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function parseReleaseId(value: string): number {
  const releaseId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(releaseId) || releaseId <= 0) {
    notFound();
  }

  return releaseId;
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
      return "回收站";
    default:
      return value;
  }
}

function statusBadgeClass(value: string): string {
  if (value === "published") {
    return "approved";
  }

  if (value === "hidden" || value === "deleted") {
    return "rejected";
  }

  return "pending";
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : count.toLocaleString("zh-CN");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
