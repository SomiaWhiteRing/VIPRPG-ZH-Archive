import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { getArchiveVersionForAdminEdit } from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatDate, formatNumber, formatUnreadCount, formatBytes } from "@/lib/format";
import { archiveStatusLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

type AdminArchiveVersionEditPageProps = {
  params: Promise<{
    archiveVersionId: string;
  }>;
};

export default async function AdminArchiveVersionEditPage({
  params,
}: AdminArchiveVersionEditPageProps) {
  const { archiveVersionId: rawArchiveVersionId } = await params;
  const archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);
  const adminUser = await requireAdminPageUser(
    `/admin/archive-versions/${archiveVersionId}`,
  );
  const [archiveVersion, unreadInboxCount] = await Promise.all([
    getArchiveVersionForAdminEdit(archiveVersionId),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  if (!archiveVersion) {
    notFound();
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">编辑归档快照</p>
          <h1>{archiveVersion.archiveLabel}</h1>
          <p className="subtitle">
            所属作品：{archiveVersion.workTitle} / {archiveVersion.releaseLabel}
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href={`/admin/releases/${archiveVersion.releaseId}`}>
            返回发布版本
          </Link>
          <Link className="button" href="/admin/archive-versions">
            归档维护
          </Link>
          <Link className="button" href={`/games/${archiveVersion.workSlug}`}>
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
        action={`/api/admin/archive-versions/${archiveVersion.id}/update`}
        className="card form-card stack-form"
        method="post"
      >
        <input name="archive_version_id" type="hidden" value={archiveVersion.id} />

        <section className="form-section">
          <h2>归档快照资料</h2>
          <div className="upload-form-grid">
            <label className="field">
              归档快照 key
              <input readOnly value={archiveVersion.archiveKey} />
              <span className="muted-line">不可修改</span>
            </label>
            <label className="field">
              归档快照名称
              <input
                defaultValue={archiveVersion.archiveLabel}
                name="archive_label"
                required
                type="text"
              />
            </label>
            <label className="field">
              快照分支
              <input
                defaultValue={archiveVersion.archiveVariantLabel}
                name="archive_variant_label"
                required
                type="text"
              />
            </label>
            <label className="field">
              语言
              <input
                defaultValue={archiveVersion.language}
                name="language"
                required
                type="text"
              />
            </label>
            <label className="field">
              状态
              <select defaultValue={archiveVersion.status} name="status">
                <option value="published">已发布</option>
                <option value="hidden">隐藏</option>
                <option value="draft">草稿</option>
              </select>
            </label>
            <label className="checkbox-line">
              <input
                defaultChecked={archiveVersion.isProofread}
                name="is_proofread"
                type="checkbox"
                value="1"
              />
              已校对
            </label>
            <label className="checkbox-line">
              <input
                defaultChecked={archiveVersion.isImageEdited}
                name="is_image_edited"
                type="checkbox"
                value="1"
              />
              已修图
            </label>
          </div>
        </section>

        <div className="actions">
          <button className="button primary" type="submit">
            保存归档快照
          </button>
          {archiveVersion.status === "published" && !archiveVersion.isCurrent ? (
            <button
              className="button"
              form="set-current-archive-version"
              type="submit"
            >
              设为当前
            </button>
          ) : null}
        </div>
      </form>

      {archiveVersion.status === "published" && !archiveVersion.isCurrent ? (
        <form
          action={`/api/admin/archive-versions/${archiveVersion.id}/current`}
          className="inline-form"
          id="set-current-archive-version"
          method="post"
        />
      ) : null}

      <section className="section-grid admin-archive-detail-grid" aria-label="归档只读信息">
        <section className="card">
          <h2>当前状态</h2>
          <dl className="detail-list">
            <div>
              <dt>状态</dt>
              <dd>{archiveStatusLabel(archiveVersion.status, null)}</dd>
            </div>
            <div>
              <dt>当前版本</dt>
              <dd>{archiveVersion.isCurrent ? "是" : "否"}</dd>
            </div>
            <div>
              <dt>上传者</dt>
              <dd>{archiveVersion.uploaderName ?? "未知"}</dd>
            </div>
            <div>
              <dt>发布时间</dt>
              <dd>{archiveVersion.publishedAt ? formatDate(archiveVersion.publishedAt) : "未发布"}</dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h2>规模</h2>
          <dl className="detail-list">
            <div>
              <dt>文件数</dt>
              <dd>{formatNumber(archiveVersion.totalFiles)}</dd>
            </div>
            <div>
              <dt>容量</dt>
              <dd>{formatBytes(archiveVersion.totalSizeBytes)}</dd>
            </div>
            <div>
              <dt>预计对象存储读取</dt>
              <dd>{formatNumber(archiveVersion.estimatedR2GetCount)}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{formatDate(archiveVersion.createdAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h2>文件清单</h2>
          <dl className="detail-list">
            <div>
              <dt>SHA-256</dt>
              <dd className="mono">{archiveVersion.manifestSha256}</dd>
            </div>
            <div>
              <dt>对象存储 key</dt>
              <dd className="mono">{archiveVersion.manifestR2Key}</dd>
            </div>
            <div>
              <dt>文件策略</dt>
              <dd>{archiveVersion.filePolicyVersion}</dd>
            </div>
            <div>
              <dt>打包器</dt>
              <dd>{archiveVersion.packerVersion}</dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h2>来源</h2>
          <dl className="detail-list">
            <div>
              <dt>来源类型</dt>
              <dd>{sourceTypeLabel(archiveVersion.sourceType)}</dd>
            </div>
            <div>
              <dt>来源名称</dt>
              <dd>{archiveVersion.sourceName ?? "未知"}</dd>
            </div>
            <div>
              <dt>源文件</dt>
              <dd>{formatNumber(archiveVersion.sourceFileCount)}</dd>
            </div>
            <div>
              <dt>源容量</dt>
              <dd>{formatBytes(archiveVersion.sourceSizeBytes)}</dd>
            </div>
            <div>
              <dt>排除文件</dt>
              <dd>
                {formatNumber(archiveVersion.excludedFileCount)} /{" "}
                {formatBytes(archiveVersion.excludedSizeBytes)}
              </dd>
            </div>
          </dl>
        </section>
      </section>
    </main>
  );
}

function parseArchiveVersionId(value: string): number {
  const archiveVersionId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(archiveVersionId) || archiveVersionId <= 0) {
    notFound();
  }

  return archiveVersionId;
}

function sourceTypeLabel(value: string): string {
  switch (value) {
    case "browser_folder":
      return "浏览器文件夹上传";
    case "browser_zip":
      return "浏览器 ZIP 上传";
    case "preindexed_manifest":
      return "预生成文件清单";
    default:
      return "未知";
  }
}
