import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { canUploadRole } from "@/lib/server/auth/roles";
import { listImportJobsForUser } from "@/lib/server/db/import-jobs";
import { formatNumber, formatBytes, formatDate } from "@/lib/format";
import { importTaskStageLabel } from "@/lib/labels";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";

export const dynamic = "force-dynamic";

export default async function UploadTasksPage() {
  const currentUser = await getCurrentUserFromCookies();

  if (!currentUser) {
    redirect(`/login?next=${encodeURIComponent("/upload/tasks")}`);
  }

  if (!canUploadRole(currentUser.role)) {
    redirect("/me");
  }

  const jobs = await listImportJobsForUser(currentUser, 50);

  return (
    <main>
      <PageHeader
        actions={
          <Link className="button primary" href="/upload">
            新建上传
          </Link>
        }
        eyebrow="Upload Tasks"
        subtitle="正在进行和最近完成的导入任务。"
        title="我的导入任务"
      />

      {jobs.length === 0 ? (
        <EmptyState
          action={{ href: "/upload", label: "开始上传" }}
          title="还没有任务。进入上传工作区，选择本地游戏目录后会自动创建导入任务。"
        />
      ) : (
        <TableWrap label="导入任务" minWidth={760}>
          <thead>
              <tr>
                <th>任务</th>
                <th>状态</th>
                <th>规模</th>
                <th>新增文件</th>
                <th>时间</th>
              </tr>
          </thead>
          <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <strong>#{job.id}</strong>
                    <span className="muted-line">{job.source_name ?? "未命名"}</span>
                    {job.archive_version_id ? (
                      <span className="muted-line mono">
                        归档快照 #{job.archive_version_id}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <StatusBadge kind="import-task" value={job.status} />
                    {job.failed_stage ? (
                      <span className="muted-line">
                        {/* ponytail: only two API stages exist; extend this mapping with the API. */}
                        失败阶段：
                        {importTaskStageLabel(job.failed_stage)}
                      </span>
                    ) : null}
                    {job.error_message ? (
                      <span className="muted-line">{job.error_message}</span>
                    ) : null}
                  </td>
                  <td>
                    {formatNumber(job.file_count)} 文件
                    <span className="muted-line">
                      {formatBytes(job.source_size_bytes ?? 0)}
                    </span>
                  </td>
                  <td>
                    {formatNumber(job.uploaded_blob_count)} 个文件 /{" "}
                    {formatNumber(job.uploaded_core_pack_count)} 组引擎公共文件
                    <span className="muted-line">
                      {formatBytes(
                        job.uploaded_blob_size_bytes +
                          job.uploaded_core_pack_size_bytes,
                      )}
                    </span>
                  </td>
                  <td>
                    {formatDate(job.created_at)}
                    {job.completed_at ? (
                      <span className="muted-line">
                        完成 {formatDate(job.completed_at)}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
          </tbody>
        </TableWrap>
      )}
    </main>
  );
}
