import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import {
  canAccessSuperAdminRole,
  canManageUsersRole,
  canUploadRole,
  roleLabel,
} from "@/lib/server/auth/roles";
import {
  countUnreadInboxItemsForUser,
  listInboxItemsForUser,
} from "@/lib/server/db/inbox";
import { listImportJobsForUser } from "@/lib/server/db/import-jobs";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const currentUser = await getCurrentUserFromCookies();

  if (!currentUser) {
    redirect(`/login?next=${encodeURIComponent("/me")}`);
  }

  const [unread, inbox, jobs] = await Promise.all([
    countUnreadInboxItemsForUser(currentUser),
    listInboxItemsForUser(currentUser),
    canUploadRole(currentUser.role)
      ? listImportJobsForUser(currentUser, 5)
      : Promise.resolve([]),
  ]);

  const pendingUploadRequest = inbox.find(
    (item) =>
      item.type === "role_change_request" &&
      item.status === "pending" &&
      item.requestedRole === "uploader" &&
      item.targetUserId === currentUser.id,
  );

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">My Account</p>
          <h1>我的账户</h1>
          <p className="subtitle">
            欢迎，{currentUser.displayName}（{roleLabel(currentUser.role)}）。
            站内信、上传权限、最近导入任务都在这里集中管理。
          </p>
        </div>
      </header>

      <div className="me-grid">
        <aside className="me-card-stack" aria-label="账户摘要">
          <section className="card">
            <h2>账户</h2>
            <dl className="detail-list">
              <div>
                <dt>显示名</dt>
                <dd>{currentUser.displayName}</dd>
              </div>
              <div>
                <dt>当前层级</dt>
                <dd>{roleLabel(currentUser.role)}</dd>
              </div>
              <div>
                <dt>站内信未读</dt>
                <dd>{formatNumber(unread)}</dd>
              </div>
            </dl>
            <div className="actions">
              <Link className="button" href="/inbox">
                打开站内信
              </Link>
              <form action="/api/auth/logout" method="post" className="inline-form">
                <input type="hidden" name="next" value="/" />
                <button className="button" type="submit">
                  退出登录
                </button>
              </form>
            </div>
          </section>

          <section className="card">
            <h2>权限与上传</h2>
            {canUploadRole(currentUser.role) ? (
              <>
                <p className="muted-line">
                  当前已是上传者，可使用浏览器预索引导入。
                </p>
                <div className="actions">
                  <Link className="button primary" href="/upload">
                    进入上传工作区
                  </Link>
                  <Link className="button" href="/upload/tasks">
                    我的导入任务
                  </Link>
                </div>
              </>
            ) : pendingUploadRequest ? (
              <p className="muted-line">
                上传者权限申请已提交，等待管理员处理。可以在
                <Link href="/inbox"> 站内信 </Link>
                跟踪进度。
              </p>
            ) : (
              <>
                <p>
                  当前账户为普通用户，需要上传者层级才能上传归档。
                  申请会进入站内信系统，由管理员处理。
                </p>
                <form
                  action="/api/account/request-upload-access"
                  method="post"
                  className="actions"
                >
                  <button className="button primary" type="submit">
                    申请成为上传者
                  </button>
                </form>
              </>
            )}
          </section>

          {canManageUsersRole(currentUser.role) ? (
            <section className="card">
              <h2>管理</h2>
              <p className="muted-line">
                管理员入口与用户层级、审计日志相关功能。
              </p>
              <div className="actions">
                <Link className="button primary" href="/admin">
                  进入控制台
                </Link>
                {canAccessSuperAdminRole(currentUser.role) ? (
                  <Link className="button" href="/admin/audit">
                    审计日志
                  </Link>
                ) : null}
              </div>
            </section>
          ) : null}
        </aside>

        <section className="card" aria-label="最近站内信">
          <h2>最近站内信</h2>
          {inbox.length === 0 ? (
            <p className="muted-line">暂时没有站内信。</p>
          ) : (
            <ul className="plain-list">
              {inbox.slice(0, 6).map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span className="muted-line">{item.body}</span>
                  <span className="muted-line">
                    {formatDate(item.createdAt)}
                    {!item.readAt ? " · 未读" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="actions">
            <Link className="button" href="/inbox">
              查看全部
            </Link>
          </div>

          {canUploadRole(currentUser.role) ? (
            <>
              <h2 style={{ marginTop: 24 }}>最近导入任务</h2>
              {jobs.length === 0 ? (
                <p className="muted-line">还没有导入任务。前往上传工作区开始。</p>
              ) : (
                <ul className="plain-list">
                  {jobs.map((job) => (
                    <li key={job.id}>
                      <strong>
                        #{job.id} {job.source_name ?? "未命名"}
                      </strong>
                      <span className="muted-line">
                        状态：{job.status}
                        {job.failed_stage ? ` · ${job.failed_stage}` : ""}
                        {job.archive_version_id
                          ? ` · ArchiveVersion #${job.archive_version_id}`
                          : ""}
                      </span>
                      <span className="muted-line">
                        {formatDate(job.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="actions">
                <Link className="button" href="/upload/tasks">
                  全部任务
                </Link>
                <Link className="button primary" href="/upload">
                  开始新上传
                </Link>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatDate(value: string): string {
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
