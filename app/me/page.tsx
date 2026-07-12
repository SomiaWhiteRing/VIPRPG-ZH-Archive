import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import {
  canAccessSuperAdminRole,
  canManageUsersRole,
  canUploadRole,
} from "@/lib/server/auth/roles";
import {
  countUnreadInboxItemsForUser,
  listInboxItemsForUser,
} from "@/lib/server/db/inbox";
import { listImportJobsForUser } from "@/lib/server/db/import-jobs";
import { formatNumber, formatDate } from "@/lib/format";
import {
  importTaskStageLabel,
  importTaskStatusLabel,
  roleLabel,
} from "@/lib/labels";

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
                  当前账户已有上传权限。
                </p>
                <div className="actions">
                  <Link className="button primary" href="/upload">
                    上传归档
                  </Link>
                  <Link className="button" href="/upload/tasks">
                    查看导入任务
                  </Link>
                </div>
              </>
            ) : pendingUploadRequest ? (
              <p className="muted-line">
                申请已提交，等待处理。结果会通过
                <Link href="/inbox"> 站内信 </Link>
                通知。
              </p>
            ) : (
              <>
                <p>
                  当前为普通用户。提交上传者申请后，管理员会通过站内信回复结果。
                </p>
                <form
                  action="/api/account/request-upload-access"
                  method="post"
                  className="actions"
                >
                  <button className="button primary" type="submit">
                    提交申请
                  </button>
                </form>
              </>
            )}
          </section>

          {canManageUsersRole(currentUser.role) ? (
            <section className="card">
              <h2>管理</h2>
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
              <h2 className="section-divider">最近导入任务</h2>
              {jobs.length === 0 ? (
                <p className="muted-line">还没有导入任务。</p>
              ) : (
                <ul className="plain-list">
                  {jobs.map((job) => (
                    <li key={job.id}>
                      <strong>
                        #{job.id} {job.source_name ?? "未命名"}
                      </strong>
                      <span className="muted-line">
                        状态：{importTaskStatusLabel(job.status)}
                        {job.failed_stage
                          ? ` · ${importTaskStageLabel(job.failed_stage)}`
                          : ""}
                        {job.archive_version_id
                          ? ` · 归档快照 #${job.archive_version_id}`
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
                  查看全部任务
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
