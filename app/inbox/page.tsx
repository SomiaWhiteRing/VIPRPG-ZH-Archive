import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import {
  canManageUsersRole,
  type UserRole,
} from "@/lib/server/auth/roles";
import {
  countUnreadInboxItemsForUser,
  listInboxItemsForUser,
  type InboxItem,
} from "@/lib/server/db/inbox";
import { formatUnreadCount, formatDate } from "@/lib/format";
import { roleLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const currentUser = await getCurrentUserFromCookies();

  if (!currentUser) {
    redirect(`/login?next=${encodeURIComponent("/inbox")}`);
  }

  const items = await listInboxItemsForUser(currentUser);
  const unreadInboxCount = await countUnreadInboxItemsForUser(currentUser);

  return (
    <main>
      <PageHeader
        actions={
          <>
            {unreadInboxCount > 0 ? (
              <form action="/api/inbox/read-all" method="post" className="inline-form">
                <button className="button primary" type="submit">
                  全部标记已读
                </button>
              </form>
            ) : null}
            {canManageUsersRole(currentUser.role) ? (
              <Link className="button" href="/admin/users">
                用户层级
              </Link>
            ) : null}
          </>
        }
        eyebrow="Inbox"
        subtitle={`当前层级：${roleLabel(currentUser.role)}`}
        title={
          <>
            站内信
            {unreadInboxCount > 0 ? (
              <span className="title-badge">
                {formatUnreadCount(unreadInboxCount)}
              </span>
            ) : null}
          </>
        }
      />

      {items.length === 0 ? (
        <EmptyState title="暂无站内信。" />
      ) : (
        <TableWrap label="站内信列表" minWidth={820}>
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
              <tr className={item.readAt ? undefined : "unread-row"} key={item.id}>
                <td>
                  <strong>{item.title}</strong>
                  {!item.readAt ? <span className="inline-unread-dot">未读</span> : null}
                  <span className="muted-line">{describeItem(item)}</span>
                  <span className="muted-line">{item.body}</span>
                </td>
                <td>{typeLabel(item.type)}</td>
                <td>
                  <StatusBadge kind="approval" value={item.status} />
                </td>
                <td>{formatDate(item.createdAt)}</td>
                <td>{renderActions(item, currentUser.role)}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </main>
  );
}

function renderActions(item: InboxItem, currentRole: UserRole) {
  if (
    item.type === "role_change_request" &&
    item.status === "pending" &&
    canManageUsersRole(currentRole)
  ) {
    return (
      <div className="actions compact-actions">
        <form action={`/api/inbox/${item.id}/resolve`} method="post">
          <input type="hidden" name="decision" value="approve" />
          <button className="button primary" type="submit">
            通过
          </button>
        </form>
        <form action={`/api/inbox/${item.id}/resolve`} method="post">
          <input type="hidden" name="decision" value="reject" />
          <button className="button" type="submit">
            驳回
          </button>
        </form>
      </div>
    );
  }

  if (!item.readAt) {
    return (
      <form action={`/api/inbox/${item.id}/read`} method="post">
        <button className="button" type="submit">
          标记已读
        </button>
      </form>
    );
  }

  return <span className="muted-line">已读</span>;
}

function describeItem(item: InboxItem): string {
  if (item.targetDisplayName && item.requestedRole) {
    return `${item.targetDisplayName} -> ${roleLabel(item.requestedRole)}`;
  }

  if (item.oldRole && item.newRole) {
    return `${roleLabel(item.oldRole)} -> ${roleLabel(item.newRole)}`;
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
