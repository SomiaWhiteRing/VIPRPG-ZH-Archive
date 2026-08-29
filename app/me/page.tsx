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
import { formatNumber, formatDate } from "@/lib/format";
import { listMyComments, listMyPlayed, listMyWishlist } from "@/lib/server/db/work-community";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const currentUser = await getCurrentUserFromCookies();

  if (!currentUser) {
    redirect(`/login?next=${encodeURIComponent("/me")}`);
  }

  const canUpload = hasPermission(currentUser, "import_job.create");

  const [unread, inbox, played, comments, wishlist] = await Promise.all([
    countUnreadInboxItemsForUser(currentUser),
    listInboxItemsForUser(currentUser),
    listMyPlayed(currentUser.id, 3),
    listMyComments(currentUser.id, null, 3),
    listMyWishlist(currentUser.id, 3),
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
      <PageHeader title="我的账户" />

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
                登出
              </Button>
            </form>
          </div>

          <div className="rounded-md border border-border bg-muted/10 p-4">
            <h3>上传权限</h3>
            {canUpload ? (
              <p>当前账户已有上传权限，可以提交游戏；上传进度会在当前标签页显示。</p>
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
            <Link className={buttonVariants({ variant: "outline" })} href="/me/games">
              我的游戏记录
            </Link>
          </div>
        </Pane>

        <Pane heading="近期游戏记录">
          <div className="grid gap-3 text-sm">
            <section>
              <strong>最近游玩</strong>
              {played.length ? <ul>{played.map((item) => <li key={item.workId}><Link href={`/games/${item.workId}`}>{item.title}</Link></li>)}</ul> : <p className="text-muted">暂无记录。</p>}
            </section>
            <section>
              <strong>最新评论</strong>
              {comments.items.length ? <ul>{comments.items.map((item) => <li key={item.id}><Link href={`/games/${item.workId}#comment-${item.id}`}>#{item.id} 评论</Link></li>)}</ul> : <p className="text-muted">暂无评论。</p>}
            </section>
            <section>
              <strong>待玩</strong>
              {wishlist.length ? <ul>{wishlist.map((item) => <li key={item.workId}><Link href={`/games/${item.workId}`}>{item.title}</Link></li>)}</ul> : <p className="text-muted">暂无待玩游戏。</p>}
            </section>
          </div>
          <Link className={buttonVariants({ variant: "outline" })} href="/me/games">查看全部记录</Link>
        </Pane>

      </div>
    </main>
  );
}
