import Link from "next/link";
import { redirect } from "next/navigation";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
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
      <PageHeader eyebrow="My Account" title="我的账户" />

      <div className="me-dashboard">
        <Pane heading="账号状态">
          <StatList
            items={[
              { label: "显示名", value: currentUser.displayName },
              { label: "当前层级", value: roleLabel(currentUser.role) },
              { label: "站内信未读", value: formatNumber(unread) },
            ]}
          />
          <div className="actions">
            <form action="/api/auth/logout" method="post" className="inline-form">
              <input type="hidden" name="next" value="/" />
              <button className="button" type="submit">
                退出登录
              </button>
            </form>
          </div>

          <div className="account-permission-block">
            <h3>上传权限</h3>
            {canUploadRole(currentUser.role) ? (
              <p>当前账户已有上传权限，可以提交归档并跟踪导入任务。</p>
            ) : pendingUploadRequest ? (
              <p>
                申请已提交，等待管理员处理。结果会通过
                <Link href="/inbox">站内信</Link>
                通知。
              </p>
            ) : (
              <>
                <p>当前为普通用户。提交上传者申请后，管理员会通过站内信回复结果。</p>
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
          </div>

          {canManageUsersRole(currentUser.role) ? (
            <div className="account-permission-block">
              <h3>管理工具</h3>
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
            </div>
          ) : null}
        </Pane>

        <Pane heading="站内信">
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
            <InboxLink unread={unread} />
          </div>
        </Pane>

        <Pane heading="最近任务">
          {canUploadRole(currentUser.role) ? (
            <>
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
          ) : (
            <p className="muted-line">取得上传权限后，可在这里跟踪导入任务。</p>
          )}
        </Pane>
      </div>
    </main>
  );
}
