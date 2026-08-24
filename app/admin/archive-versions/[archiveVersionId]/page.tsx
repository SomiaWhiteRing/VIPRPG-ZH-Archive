import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import { CheckboxField } from "@/app/components/ui/checkbox-field";
import { Button, buttonVariants } from "@/app/components/ui/button";
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
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { getArchiveVersionForAdminEdit } from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatDate, formatNumber, formatBytes } from "@/lib/format";

export const dynamic = "force-dynamic";

type AdminArchiveVersionEditPageProps = {
  params: Promise<{
    archiveVersionId: string;
  }>;
};

export default async function AdminArchiveVersionEditPage({ params }: AdminArchiveVersionEditPageProps) {
  const { archiveVersionId: rawArchiveVersionId } = await params;
  const archiveVersionId = parseArchiveVersionId(rawArchiveVersionId);
  const adminUser = await requirePagePermission(
    `/admin/archive-versions/${archiveVersionId}`,
    "archive_version.update",
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
        eyebrow="编辑文件版本"
        title={archiveVersion.archiveLabel}
        subtitle={`所属作品：${archiveVersion.workTitle} / ${archiveVersion.releaseLabel}`}
        actions={
          <>
            <BackLink href={`/admin/releases/${archiveVersion.releaseId}`} label="返回发布版本" />
            <Link className={buttonVariants({ variant: "outline" })} href="/admin/archive-versions">
              版本管理
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href={`/games/${archiveVersion.workSlug}`}>
              查看公开页
            </Link>
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <form
        action={`/api/admin/archive-versions/${archiveVersion.id}/update`}
        className="rounded-lg border border-border bg-card p-5 text-card-foreground shadow-sm min-h-0 grid gap-4"
        method="post"
      >
        <input name="archive_version_id" type="hidden" value={archiveVersion.id} />

        <section className="grid gap-3">
          <SectionHeading title="文件版本资料" />
          <div className="grid gap-4 md:grid-cols-2">
            <FormField hint="不可修改" label="文件版本 key">
              <Input readOnly value={archiveVersion.archiveKey} />
            </FormField>
            <FormField label="文件版本名称">
              <Input defaultValue={archiveVersion.archiveLabel} name="archive_label" required type="text" />
            </FormField>
            <FormField label="快照分支">
              <Input
                defaultValue={archiveVersion.archiveVariantLabel}
                name="archive_variant_label"
                required
                type="text"
              />
            </FormField>
            <FormField label="语言">
              <Input defaultValue={archiveVersion.language} name="language" required type="text" />
            </FormField>
            <FormField label="状态">
              <SelectField
                defaultValue={archiveVersion.status}
                name="status"
                options={[
                  { value: "published", label: "已发布" },
                  { value: "hidden", label: "隐藏" },
                  { value: "draft", label: "草稿" },
                ]}
              />
            </FormField>
            <CheckboxField defaultChecked={archiveVersion.isProofread} label="已校对" name="is_proofread" />
            <CheckboxField defaultChecked={archiveVersion.isImageEdited} label="已修图" name="is_image_edited" />
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">保存文件版本</Button>
          {archiveVersion.status === "published" && !archiveVersion.isCurrent ? (
            <Button variant="outline" form="set-current-archive-version" type="submit">
              设为当前
            </Button>
          ) : null}
        </div>
      </form>

      {archiveVersion.status === "published" && !archiveVersion.isCurrent ? (
        <form
          action={`/api/admin/archive-versions/${archiveVersion.id}/current`}
          className="inline-flex"
          id="set-current-archive-version"
          method="post"
        />
      ) : null}

      <section className="grid gap-3 md:grid-cols-3 grid gap-4 lg:grid-cols-3" aria-label="文件版本只读信息">
        <Pane heading="当前状态">
          <StatList
            items={[
              {
                label: "状态",
                value: <StatusBadge kind="archive" value={archiveVersion.status} />,
              },
              {
                label: "当前版本",
                value: archiveVersion.isCurrent ? "是" : "否",
              },
              { label: "上传者", value: archiveVersion.uploaderName ?? "未知" },
              {
                label: "发布时间",
                value: archiveVersion.publishedAt ? formatDate(archiveVersion.publishedAt) : "未发布",
              },
            ]}
          />
        </Pane>

        <Pane heading="规模">
          <StatList
            items={[
              {
                label: "文件数",
                value: formatNumber(archiveVersion.totalFiles),
              },
              {
                label: "容量",
                value: formatBytes(archiveVersion.totalSizeBytes),
              },
              {
                label: "预计对象存储读取",
                value: formatNumber(archiveVersion.estimatedR2GetCount),
              },
              {
                label: "创建时间",
                value: formatDate(archiveVersion.createdAt),
              },
            ]}
          />
        </Pane>

        <Pane heading="文件清单">
          <StatList
            items={[
              {
                label: "SHA-256",
                value: <span className="font-mono text-sm text-primary">{archiveVersion.manifestSha256}</span>,
              },
              { label: "文件策略", value: archiveVersion.filePolicyVersion },
              { label: "打包器", value: archiveVersion.packerVersion },
            ]}
          />
        </Pane>

        <Pane heading="来源">
          <StatList
            items={[
              {
                label: "来源类型",
                value: sourceTypeLabel(archiveVersion.sourceType),
              },
              { label: "来源名称", value: archiveVersion.sourceName ?? "未知" },
              {
                label: "源文件",
                value: formatNumber(archiveVersion.sourceFileCount),
              },
              {
                label: "源容量",
                value: formatBytes(archiveVersion.sourceSizeBytes),
              },
              {
                label: "排除文件",
                value: `${formatNumber(archiveVersion.excludedFileCount)} / ${formatBytes(archiveVersion.excludedSizeBytes)}`,
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
