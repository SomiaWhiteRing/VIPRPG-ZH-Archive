import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { StatList } from "@/app/components/ui/stat-list";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import { getArchiveVersionForAdminEdit } from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatDate, formatNumber, formatBytes } from "@/lib/format";

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
      <PageHeader
        eyebrow="编辑归档快照"
        title={archiveVersion.archiveLabel}
        subtitle={`所属作品：${archiveVersion.workTitle} / ${archiveVersion.releaseLabel}`}
        actions={
          <>
            <BackLink
              href={`/admin/releases/${archiveVersion.releaseId}`}
              label="返回发布版本"
            />
            <Link className="button" href="/admin/archive-versions">
              归档维护
            </Link>
            <Link className="button" href={`/games/${archiveVersion.workSlug}`}>
              查看公开页
            </Link>
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <form
        action={`/api/admin/archive-versions/${archiveVersion.id}/update`}
        className="card form-card stack-form"
        method="post"
      >
        <input name="archive_version_id" type="hidden" value={archiveVersion.id} />

        <section className="form-section">
          <SectionHeading title="归档快照资料" />
          <div className="upload-form-grid">
            <FormField hint="不可修改" label="归档快照 key">
              <input readOnly value={archiveVersion.archiveKey} />
            </FormField>
            <FormField label="归档快照名称">
              <input
                defaultValue={archiveVersion.archiveLabel}
                name="archive_label"
                required
                type="text"
              />
            </FormField>
            <FormField label="快照分支">
              <input
                defaultValue={archiveVersion.archiveVariantLabel}
                name="archive_variant_label"
                required
                type="text"
              />
            </FormField>
            <FormField label="语言">
              <input
                defaultValue={archiveVersion.language}
                name="language"
                required
                type="text"
              />
            </FormField>
            <FormField label="状态">
              <select defaultValue={archiveVersion.status} name="status">
                <option value="published">已发布</option>
                <option value="hidden">隐藏</option>
                <option value="draft">草稿</option>
              </select>
            </FormField>
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
        <Pane heading="当前状态">
          <StatList
            items={[
              {
                label: "状态",
                value: <StatusBadge kind="archive" value={archiveVersion.status} />,
              },
              { label: "当前版本", value: archiveVersion.isCurrent ? "是" : "否" },
              { label: "上传者", value: archiveVersion.uploaderName ?? "未知" },
              {
                label: "发布时间",
                value: archiveVersion.publishedAt
                  ? formatDate(archiveVersion.publishedAt)
                  : "未发布",
              },
            ]}
          />
        </Pane>

        <Pane heading="规模">
          <StatList
            items={[
              { label: "文件数", value: formatNumber(archiveVersion.totalFiles) },
              { label: "容量", value: formatBytes(archiveVersion.totalSizeBytes) },
              {
                label: "预计对象存储读取",
                value: formatNumber(archiveVersion.estimatedR2GetCount),
              },
              { label: "创建时间", value: formatDate(archiveVersion.createdAt) },
            ]}
          />
        </Pane>

        <Pane heading="文件清单">
          <StatList
            items={[
              {
                label: "SHA-256",
                value: <span className="mono">{archiveVersion.manifestSha256}</span>,
              },
              {
                label: "对象存储 key",
                value: <span className="mono">{archiveVersion.manifestR2Key}</span>,
              },
              { label: "文件策略", value: archiveVersion.filePolicyVersion },
              { label: "打包器", value: archiveVersion.packerVersion },
            ]}
          />
        </Pane>

        <Pane heading="来源">
          <StatList
            items={[
              { label: "来源类型", value: sourceTypeLabel(archiveVersion.sourceType) },
              { label: "来源名称", value: archiveVersion.sourceName ?? "未知" },
              { label: "源文件", value: formatNumber(archiveVersion.sourceFileCount) },
              { label: "源容量", value: formatBytes(archiveVersion.sourceSizeBytes) },
              {
                label: "排除文件",
                value: `${formatNumber(archiveVersion.excludedFileCount)} / ${formatBytes(
                  archiveVersion.excludedSizeBytes,
                )}`,
              },
            ]}
          />
        </Pane>
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
