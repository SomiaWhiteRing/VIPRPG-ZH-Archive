import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { getReleaseForAdminEdit } from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatNumber, formatUnreadCount, formatBytes } from "@/lib/format";
import { archiveStatusBadgeClass, archiveStatusLabel } from "@/lib/labels";

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
          <p className="eyebrow">编辑发布版本</p>
          <h1>{release.label}</h1>
          <p className="subtitle">所属作品：{release.workTitle}</p>
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
              发布版本 key
              <input readOnly value={release.key} />
              <span className="muted-line">不可修改</span>
            </label>
            <label className="field">
              发布版本名称
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
              发布版本类型
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
              <textarea
                defaultValue={release.tags.join("\n")}
                name="tags"
                placeholder="短篇"
                rows={5}
              />
              <span className="muted-line">每行一个标签；也可用逗号分隔。</span>
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
                placeholder="补丁说明|https://example.com/patch|patch_note"
                rows={5}
              />
              <span className="muted-line">
                每行一个链接，字段用 | 分隔；类型：official、source、download_page、patch_note、other。
              </span>
            </label>
          </div>
        </section>

        <div className="actions">
          <button className="button primary" type="submit">
            保存发布版本
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
                  <span className={`badge ${archiveStatusBadgeClass(archive.status, null)}`}>
                    {archiveStatusLabel(archive.status, null)}
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
