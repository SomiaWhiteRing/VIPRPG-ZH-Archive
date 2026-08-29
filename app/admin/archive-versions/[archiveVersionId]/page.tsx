import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import { Button, buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { FormField } from "@/app/components/ui/form-field";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { StatList } from "@/app/components/ui/stat-list";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { getArchiveVersionForAdminEdit } from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import { StickySaveBar } from "@/app/admin/admin-list-controls";

export const dynamic = "force-dynamic";

export default async function AdminArchiveVersionEditPage({
  params,
}: {
  params: Promise<{ archiveVersionId: string }>;
}) {
  const archiveVersionId = parseId((await params).archiveVersionId);
  const adminUser = await requirePagePermission(
    `/admin/archive-versions/${archiveVersionId}`,
    "archive_version.update",
  );
  const [archiveVersion, unreadInboxCount] = await Promise.all([
    getArchiveVersionForAdminEdit(archiveVersionId),
    countUnreadInboxItemsForUser(adminUser),
  ]);
  if (!archiveVersion) notFound();
  return (
    <main>
      <PageHeader
        compact
        eyebrow="编辑归档快照"
        title={`归档 #${archiveVersion.id}`}
        subtitle={`所属游戏：${archiveVersion.workTitle}`}
        actions={
          <>
            <BackLink href="/admin/archive-versions" label="返回归档管理" />
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/admin/works/${archiveVersion.workId}`}
            >
              编辑游戏
            </Link>
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/games/${archiveVersion.workId}`}
            >
              查看公开页
            </Link>
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />
      <form
        action={`/api/admin/archive-versions/${archiveVersion.id}/update`}
        className="grid gap-4"
        method="post"
      >
        <input
          name="archive_version_id"
          type="hidden"
          value={archiveVersion.id}
        />
        <Pane heading="快照资料">
          <SectionHeading title="只修改归档事实，不改变游戏关系" />
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="状态">
              <SelectField
                defaultValue={archiveVersion.status}
                name="status"
                options={[
                  { value: "published", label: "已发布" },
                  { value: "hidden", label: "隐藏" },
                ]}
              />
            </FormField>
            <FormField label="来源名称">
              <Input
                defaultValue={archiveVersion.sourceName ?? ""}
                name="source_name"
              />
            </FormField>
            <FormField label="来源网址">
              <Input
                defaultValue={archiveVersion.sourceUrl ?? ""}
                name="source_url"
                type="url"
              />
            </FormField>
          </div>
        </Pane>
        <StickySaveBar>
          <Button type="submit">保存归档</Button>
          {archiveVersion.status === "published" &&
          !archiveVersion.isCurrent ? (
            <Button
              form="set-current-archive-version"
              type="submit"
              variant="outline"
            >
              设为当前
            </Button>
          ) : null}
        </StickySaveBar>
      </form>
      {archiveVersion.status === "published" && !archiveVersion.isCurrent ? (
        <form
          action={`/api/admin/archive-versions/${archiveVersion.id}/current`}
          id="set-current-archive-version"
          method="post"
        />
      ) : null}
      <section className="grid gap-4 md:grid-cols-3">
        <Pane heading="状态">
          <StatList
            items={[
              {
                label: "状态",
                value: (
                  <StatusBadge kind="archive" value={archiveVersion.status} />
                ),
              },
              {
                label: "当前快照",
                value: archiveVersion.isCurrent ? "是" : "否",
              },
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
              {
                label: "文件数",
                value: formatNumber(archiveVersion.totalFiles),
              },
              {
                label: "容量",
                value: formatBytes(archiveVersion.totalSizeBytes),
              },
              {
                label: "对象存储读取",
                value: formatNumber(archiveVersion.estimatedR2GetCount),
              },
              {
                label: "创建时间",
                value: formatDate(archiveVersion.createdAt),
              },
            ]}
          />
        </Pane>
        <Pane heading="清单">
          <StatList
            items={[
              {
                label: "SHA-256",
                value: (
                  <span className="font-mono text-sm">
                    {archiveVersion.manifestSha256}
                  </span>
                ),
              },
              { label: "文件策略", value: archiveVersion.filePolicyVersion },
              { label: "打包器", value: archiveVersion.packerVersion },
            ]}
          />
        </Pane>
      </section>
    </main>
  );
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  return id;
}
