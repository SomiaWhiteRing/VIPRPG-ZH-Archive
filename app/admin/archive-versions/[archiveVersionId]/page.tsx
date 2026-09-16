import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getArchiveVersionForAdminEdit } from "@/app/.server/db/game-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { StickySaveBar } from "@/app/admin/admin-list-controls";
import { BackLink } from "@/app/components/ui/back-link";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { SelectField } from "@/app/components/ui/select";
import { StatList } from "@/app/components/ui/stat-list";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { hasPermission } from "@/lib/authz/permissions";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const archiveVersionId = parseId((await params).archiveVersionId);
  const adminUser = await requirePagePermission(
    runtime,
    `/admin/archive-versions/${archiveVersionId}`,
    "archive_version.update",
  );
  const archiveVersion = await getArchiveVersionForAdminEdit(
    runtime,
    archiveVersionId,
  );
  if (!archiveVersion) throwNotFound();

  return {
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    archiveVersion,
  };
}

export default function AdminArchiveVersionEditPage() {
  const { adminUser, archiveVersion } = useLoaderData<typeof loader>();
  return (
    <main key={archiveVersion.id}>
      <PageHeader
        compact
        eyebrow="编辑归档快照"
        title={`归档 #${archiveVersion.id}`}
        subtitle={`所属游戏：${archiveVersion.workTitle}`}
        actions={
          <>
            <BackLink href="/admin/archive-versions" label="返回归档管理" />
            {hasPermission(adminUser, "work.metadata.update_any") ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                to={`/admin/works/${archiveVersion.workId}`}
              >
                编辑游戏
              </Link>
            ) : null}
            <Link
              className={buttonVariants({ variant: "outline" })}
              to={`/games/${archiveVersion.workId}`}
            >
              查看公开页
            </Link>
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
            <FormField
              controlId="admin-archive-versions-archiveVersionId--field-1"
              label="状态"
            >
              <SelectField
                id="admin-archive-versions-archiveVersionId--field-1"
                aria-label="状态"
                defaultValue={archiveVersion.status}
                name="status"
                options={[
                  { value: "published", label: "已发布" },
                  { value: "hidden", label: "隐藏" },
                ]}
              />
            </FormField>
            <FormField
              controlId="admin-archive-versions-archiveVersionId--field-2"
              label="来源名称"
            >
              <Input
                id="admin-archive-versions-archiveVersionId--field-2"
                defaultValue={archiveVersion.sourceName ?? ""}
                name="source_name"
              />
            </FormField>
            <FormField
              controlId="admin-archive-versions-archiveVersionId--field-3"
              label="来源网址"
            >
              <Input
                id="admin-archive-versions-archiveVersionId--field-3"
                defaultValue={archiveVersion.sourceUrl ?? ""}
                name="source_url"
                type="url"
              />
            </FormField>
          </div>
        </Pane>
        <StickySaveBar>
          <Button type="submit">保存归档</Button>
          {hasPermission(adminUser, "archive_version.set_current") &&
          archiveVersion.status === "published" &&
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
      {hasPermission(adminUser, "archive_version.set_current") &&
      archiveVersion.status === "published" &&
      !archiveVersion.isCurrent ? (
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
  if (!Number.isSafeInteger(id) || id <= 0) throwNotFound();
  return id;
}
