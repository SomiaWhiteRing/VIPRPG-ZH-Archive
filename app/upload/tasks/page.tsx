import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { canUploadRole } from "@/lib/server/auth/roles";
import { listImportJobsForUser } from "@/lib/server/db/import-jobs";

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
      <header className="page-header">
        <div>
          <p className="eyebrow">Upload Tasks</p>
          <h1>我的导入任务</h1>
          <p className="subtitle">
            查看正在进行和最近完成的导入任务。导入任务记录了 preflight、缺失对象、上传与 commit 的状态。
          </p>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/upload">
            新建上传
          </Link>
        </div>
      </header>

      {jobs.length === 0 ? (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>还没有任务</h2>
          <p>
            进入上传工作区，选择本地游戏目录后会自动创建导入任务。
          </p>
          <div className="actions">
            <Link className="button primary" href="/upload">
              开始上传
            </Link>
          </div>
        </section>
      ) : (
        <section className="table-wrap" aria-label="导入任务">
          <table className="data-table admin-ops-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>状态</th>
                <th>规模</th>
                <th>新增对象</th>
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
                        ArchiveVersion #{job.archive_version_id}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={`badge ${statusBadge(job.status)}`}>
                      {statusLabel(job.status)}
                    </span>
                    {job.failed_stage ? (
                      <span className="muted-line">{job.failed_stage}</span>
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
                    {formatNumber(job.uploaded_blob_count)} blob /{" "}
                    {formatNumber(job.uploaded_core_pack_count)} pack
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
          </table>
        </section>
      )}
    </main>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    created: "已创建",
    preflighted: "预检完成",
    uploading: "上传中",
    committed: "已提交",
    succeeded: "已完成",
    failed: "失败",
    canceled: "已取消",
  };
  return labels[status] ?? status;
}

function statusBadge(status: string): string {
  if (status === "succeeded" || status === "committed") {
    return "approved";
  }
  if (status === "failed" || status === "canceled") {
    return "rejected";
  }
  return "pending";
}
