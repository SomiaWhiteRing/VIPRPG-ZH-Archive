import { getCurrentUser } from "@/app/.server/auth/current-user";
import {
  canResolveInboxRequests,
  listInboxItemsForUser,
} from "@/app/.server/db/inbox";
import { redirectPage } from "@/app/.server/http/page-response";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Badge } from "@/app/components/ui/badge";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import type { InboxItem } from "@/lib/dto/db/inbox";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { formatDate, formatUnreadCount } from "@/lib/format";
import { forumPage } from "@/lib/forum";
import type { InboxCategory } from "@/lib/inbox";
import { inboxCategory, inboxHref } from "@/lib/inbox";
import { Bell, Heart, MessageCircle, ShieldCheck } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { InboxActions } from "./actions";
import { InboxControls } from "./controls";
import { useInboxAutoRead } from "./use-auto-read";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const params = await searchParams;
  const category = inboxCategory(params.category);
  const unread = params.unread === "1";
  const page = forumPage(params.page);
  const currentUser = await getCurrentUser(runtime);
  if (!currentUser)
    redirectPage(
      `/login?next=${encodeURIComponent(inboxHref(category, unread, page))}`,
    );
  const canResolve = canResolveInboxRequests(currentUser);
  if (category === "pending" && !canResolve)
    redirectPage(inboxHref("all", unread));
  const result = await listInboxItemsForUser(runtime, currentUser, {
    category,
    unread,
    page,
  });
  if (page !== result.page)
    redirectPage(inboxHref(category, unread, result.page));

  return { category, unread, canResolve, result };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: "提醒", page: loaderData?.result.page }, error);

export default function InboxPage() {
  const { category, unread, canResolve, result } =
    useLoaderData<typeof loader>();
  const [autoRead, setAutoRead] = useState({ result, ids: new Set<number>() });
  const onRead = useCallback(
    (itemId: number) => {
      setAutoRead((previous) => ({
        result,
        ids: new Set(previous.result === result ? previous.ids : []).add(itemId),
      }));
    },
    [result],
  );
  const unreadCount = Math.max(
    0,
    result.unread -
      result.items.filter(
        (item) =>
          !item.readAt &&
          autoRead.result === result &&
          autoRead.ids.has(item.id),
      ).length,
  );
  return (
    <PageContainer>
      <PageHeader
        compact
        title={
          <span>
            提醒
            {unreadCount > 0 ? (
              <span className="ml-3 align-middle font-sans text-sm font-normal text-muted">
                {formatUnreadCount(unreadCount)} 未读
              </span>
            ) : null}
          </span>
        }
        actions={
          <div className="min-h-9">
            {unreadCount > 0 ? <InboxActions all /> : null}
          </div>
        }
      />
      <InboxControls
        category={category}
        unread={unread}
        pendingCount={result.pending}
        canResolve={canResolve}
      />
      {result.items.length ? (
        <ul
          aria-label="提醒列表"
          className="divide-y divide-border border-b border-border"
        >
          {result.items.map((item) => (
            <InboxRow key={item.id} item={item} onRead={onRead} />
          ))}
        </ul>
      ) : (
        <EmptyState title={emptyLabel(category, unread)} />
      )}
      <PaginationLinks
        basePath="/inbox"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        prefetch={false}
        params={{
          category: category === "all" ? undefined : category,
          unread: unread ? "1" : undefined,
        }}
      />
    </PageContainer>
  );
}

function InboxRow({
  item,
  onRead,
}: {
  item: InboxItem;
  onRead: (itemId: number) => void;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const { readAt, error } = useInboxAutoRead(item, rowRef, onRead);
  const interaction = item.interaction;
  const Icon =
    item.type === "forum_like"
      ? Heart
      : item.type === "forum_reply"
        ? MessageCircle
        : item.type === "role_change_request"
          ? ShieldCheck
          : Bell;
  const approvalLabels = {
    pending: "待审核",
    approved: "已通过",
    rejected: "已驳回",
    open: "待审核",
    archived: "已归档",
  };
  return (
    <li
      ref={rowRef}
      className={`grid min-w-0 grid-cols-[36px_minmax(0,1fr)] gap-x-3 gap-y-2 px-2 py-4 hover:bg-primary/5 focus-within:bg-primary/5 sm:grid-cols-[36px_minmax(0,1fr)_auto] sm:px-3 ${readAt ? "" : "bg-primary/[0.03]"}`}
    >
      <div className="relative row-span-2 self-start">
        {interaction ? (
          <UserAvatar
            displayName={interaction.actorName}
            avatarBlobSha256={interaction.actorAvatar}
            size={36}
            className="size-9"
          />
        ) : (
          <span className="grid size-9 place-items-center rounded-md bg-muted/10">
            <Icon className="size-4 text-muted" aria-hidden />
          </span>
        )}
        {!readAt ? (
          <span className="absolute -left-1 -top-1 size-2 rounded-full bg-primary">
            <span className="sr-only">未读</span>
          </span>
        ) : null}
      </div>
      <div className="min-w-0 break-words [overflow-wrap:anywhere]">
        {interaction ? (
          <>
            <p className={`text-sm ${readAt ? "" : "font-semibold"}`}>
              {interaction.actorHref ? (
                <Link
                  className="hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                  to={interaction.actorHref}
                >
                  {interaction.actorName}
                </Link>
              ) : (
                interaction.actorName
              )}
              <span>{interaction.action}</span>
            </p>
            <Link
              to={`/inbox/${item.id}`}
              prefetch="none"
              className="mt-1 block rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="line-clamp-2 font-semibold text-primary hover:underline">
                {interaction.topicTitle}
              </span>
              <span className="mt-1 block text-xs text-muted">
                第 {interaction.postNumber} 楼
                {interaction.commentId ? " · 楼中楼" : ""}
              </span>
              {interaction.excerpt ? (
                <span className="mt-2 line-clamp-2 text-foreground">
                  {interaction.excerpt}
                </span>
              ) : null}
            </Link>
          </>
        ) : (
          <>
            <p className={`text-sm ${readAt ? "" : "font-semibold"}`}>
              {item.title}
            </p>
            {item.type === "role_change_request" ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>
                  {item.targetDisplayName} · {item.requestedRole?.name}
                </span>
                <Badge variant="outline">{approvalLabels[item.status]}</Badge>
              </div>
            ) : null}
            {item.body ? (
              <p className="mt-2 whitespace-pre-wrap text-sm">{item.body}</p>
            ) : null}
          </>
        )}
      </div>
      <time
        dateTime={utcDate(item.createdAt).toISOString()}
        title={formatDate(item.createdAt, { time: true })}
        className="col-start-2 text-xs text-muted sm:col-start-3 sm:row-start-1 sm:text-right"
      >
        {relativeTime(item.createdAt)}
      </time>
      <div className="col-start-2 min-h-9 sm:col-start-3 sm:row-start-2">
        <InboxActions
          item={{
            id: item.id,
            readAt,
            canApprove: item.canApprove,
            canReject: item.canReject,
          }}
        />
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            自动标记已读失败，请手动标记已读。
          </p>
        ) : null}
      </div>
    </li>
  );
}

function utcDate(value: string) {
  return new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
}
function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - utcDate(value).getTime()) / 60000),
  );
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时前`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}天前`;
  return formatDate(value);
}
function emptyLabel(category: InboxCategory, unread: boolean) {
  if (unread) return "没有未读提醒";
  return {
    all: "暂无提醒",
    replies: "还没有收到回复",
    likes: "还没有收到赞",
    system: "暂无系统通知",
    pending: "暂无待处理申请",
  }[category];
}

export { default as ErrorBoundary } from "@/app/inbox/error";
