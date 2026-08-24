import { Button, buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { hasPermission } from "@/lib/authz/permissions";
import { countUnreadInboxItemsForUser, listInboxItemsForUser } from "@/lib/server/db/inbox";
import { listImportJobsForUser } from "@/lib/server/db/import-jobs";
import { formatNumber, formatDate } from "@/lib/format";
import { importTaskStageLabel, importTaskStatusLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const currentUser = await getCurrentUserFromCookies();

  if (!currentUser) {
    redirect(`/login?next=${encodeURIComponent("/me")}`);
  }

  const canUpload = hasPermission(currentUser, "import_job.create");

  const [unread, inbox, jobs] = await Promise.all([
    countUnreadInboxItemsForUser(currentUser),
    listInboxItemsForUser(currentUser),
    canUpload ? listImportJobsForUser(currentUser, 5) : Promise.resolve([]),
  ]);

  const pendingUploadRequest = inbox.find(
    (item) =>
      item.type === "role_change_request" &&
      item.status === "pending" &&
      item.requestedRole?.key === "uploader" &&
      item.targetUserId === currentUser.id,
  );

  return (
    <main>
      <PageHeader eyebrow="My Account" title="我的账户" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
        <Pane heading="账号状态">
          <StatList
            items={[
              { label: "显示名", value: currentUser.displayName },
              {
                label: "当前角色",
                value: currentUser.roleNames.join("、") || "未分配角色",
              },
              { label: "站内信未读", value: formatNumber(unread) },
            ]}
          />
          <div className="flex flex-wrap items-center gap-3">
            <form action="/api/auth/logout" method="post" className="inline-flex">
              <input type="hidden" name="next" value="/" />
              <Button variant="outline" type="submit">
                退出登录
              </Button>
            </form>
          </div>

          <div className="rounded-md border border-border bg-muted/10 p-4">
            <h3>上传权限</h3>
            {canUpload ? (
              <p>当前账户已有上传权限，可以提交游戏并跟踪处理任务。</p>
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
                  className="flex flex-wrap items-center gap-3"
                >
                  <Button type="submit">提交申请</Button>
                </form>
              </>
            )}
          </div>

          {hasPermission(currentUser, "system.dashboard.read") ? (
            <div className="rounded-md border border-border bg-muted/10 p-4">
              <h3>管理工具</h3>
              <div className="flex flex-wrap items-center gap-3">
                <Link className={buttonVariants()} href="/admin">
                  进入控制台
                </Link>
                {hasPermission(currentUser, "audit.read") ? (
                  <Link className={buttonVariants({ variant: "outline" })} href="/admin/audit">
                    审计日志
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </Pane>

        <Pane heading="站内信">
          {inbox.length === 0 ? (
            <p className="text-sm text-muted">暂时没有站内信。</p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {inbox.slice(0, 6).map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span className="text-sm text-muted">{item.body}</span>
                  <span className="text-sm text-muted">
                    {formatDate(item.createdAt)}
                    {!item.readAt ? " · 未读" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <InboxLink unread={unread} />
          </div>
        </Pane>

        <Pane heading="最近任务">
          {canUpload ? (
            <>
              {jobs.length === 0 ? (
                <p className="text-sm text-muted">还没有导入任务。</p>
              ) : (
                <ul className="mt-3 grid gap-3">
                  {jobs.map((job) => (
                    <li key={job.id}>
                      <strong>
                        #{job.id} {job.source_name ?? "未命名"}
                      </strong>
                      <span className="text-sm text-muted">
                        状态：{importTaskStatusLabel(job.status)}
                        {job.failed_stage ? ` · ${importTaskStageLabel(job.failed_stage)}` : ""}
                        {job.archive_version_id ? ` · 文件版本 #${job.archive_version_id}` : ""}
                      </span>
                      <span className="text-sm text-muted">{formatDate(job.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Link className={buttonVariants({ variant: "outline" })} href="/upload/tasks">
                  查看全部任务
                </Link>
                <Link className={buttonVariants()} href="/upload">
                  开始新上传
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">取得上传权限后，可在这里跟踪导入任务。</p>
          )}
        </Pane>
      </div>
    </main>
  );
}
