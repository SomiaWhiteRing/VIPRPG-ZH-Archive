import { Button, buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { hasPermission } from "@/lib/authz/permissions";
import { countUnreadInboxItemsForUser, listInboxItemsForUser, type InboxItem } from "@/lib/server/db/inbox";
import { formatUnreadCount, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const currentUser = await getCurrentUserFromCookies();

  if (!currentUser) {
    redirect(`/login?next=${encodeURIComponent("/inbox")}`);
  }

  const items = await listInboxItemsForUser(currentUser);
  const unreadInboxCount = await countUnreadInboxItemsForUser(currentUser);
  const canResolveRoleRequests = hasPermission(currentUser, "inbox.role_request.resolve");

  return (
    <main>
      <PageHeader
        actions={
          <>
            {unreadInboxCount > 0 ? (
              <form action="/api/inbox/read-all" method="post" className="inline-flex">
                <Button type="submit">全部标记已读</Button>
              </form>
            ) : null}
            {hasPermission(currentUser, "user.read") ? (
              <Link className={buttonVariants({ variant: "outline" })} href="/admin/users">
                用户角色
              </Link>
            ) : null}
          </>
        }
        subtitle={`当前角色：${currentUser.roleNames.join("、") || "未分配角色"}`}
        title={
          <>
            提醒
            {unreadInboxCount > 0 ? (
              <span className="ml-2 align-middle">{formatUnreadCount(unreadInboxCount)}</span>
            ) : null}
          </>
        }
      />

      {items.length === 0 ? (
        <EmptyState title="暂无提醒。" />
      ) : (
        <>
          <div className="w-full overflow-x-auto">
            <TableWrap label="提醒列表" minWidth={820}>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr className={item.readAt ? undefined : "bg-accent/5"} key={item.id}>
                    <td>
                      <strong>{item.title}</strong>
                      {!item.readAt ? (
                        <span className="ml-2 rounded-full bg-red-100 px-1.5 text-[11px] text-red-800">未读</span>
                      ) : null}
                      <span className="text-sm text-muted">{describeItem(item)}</span>
                      <span className="text-sm text-muted">{item.body}</span>
                    </td>
                    <td>{typeLabel(item.type)}</td>
                    <td>
                      <StatusBadge kind="approval" value={item.status} />
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>{renderActions(item, canResolveRoleRequests)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>

          <ul className="grid gap-3" aria-label="提醒列表">
            {items.map((item) => (
              <li
                className={`rounded-lg border border-border bg-card p-4 shadow-sm${item.readAt ? "" : " border-l-4 border-accent"}`}
                key={item.id}
              >
                <header>
                  <div>
                    <strong>{item.title}</strong>
                    {!item.readAt ? (
                      <span className="ml-2 rounded-full bg-red-100 px-1.5 text-[11px] text-red-800">未读</span>
                    ) : null}
                  </div>
                  <StatusBadge kind="approval" value={item.status} />
                </header>
                <p className="text-sm text-muted">{describeItem(item)}</p>
                <p>{item.body}</p>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <dt>类型</dt>
                    <dd>{typeLabel(item.type)}</dd>
                  </div>
                  <div>
                    <dt>时间</dt>
                    <dd>{formatDate(item.createdAt)}</dd>
                  </div>
                </dl>
                <div className="mt-3">{renderActions(item, canResolveRoleRequests)}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function renderActions(item: InboxItem, canManageInbox: boolean) {
  if (item.type === "role_change_request" && item.status === "pending" && canManageInbox) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <form action={`/api/inbox/${item.id}/resolve`} method="post">
          <input type="hidden" name="decision" value="approve" />
          <Button type="submit">通过</Button>
        </form>
        <form action={`/api/inbox/${item.id}/resolve`} method="post">
          <input type="hidden" name="decision" value="reject" />
          <Button variant="outline" type="submit">
            驳回
          </Button>
        </form>
      </div>
    );
  }

  if (!item.readAt) {
    return (
      <form action={`/api/inbox/${item.id}/read`} method="post">
        <Button variant="outline" type="submit">
          标记已读
        </Button>
      </form>
    );
  }

  return <span className="text-sm text-muted">已读</span>;
}

function describeItem(item: InboxItem): string {
  if (item.targetDisplayName && item.requestedRole) {
    return `${item.targetDisplayName} -> ${item.requestedRole.name}`;
  }

  return item.senderDisplayName ? `来自 ${item.senderDisplayName}` : "系统消息";
}

function typeLabel(type: InboxItem["type"]): string {
  switch (type) {
    case "role_change_request":
      return "角色申请";
    case "role_change_notice":
      return "角色通知";
    case "system_notice":
      return "系统通知";
  }
}
