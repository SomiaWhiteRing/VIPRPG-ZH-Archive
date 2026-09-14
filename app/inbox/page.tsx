import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, Heart, MessageCircle, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { Badge } from "@/app/components/ui/badge";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { canResolveInboxRequests, listInboxItemsForUser, type InboxItem } from "@/lib/server/db/inbox";
import { formatUnreadCount, formatDate } from "@/lib/format";
import { inboxCategory, inboxHref, type InboxCategory } from "@/lib/inbox";
import { forumPage } from "@/lib/forum";
import { InboxControls, InboxFeedback } from "./controls";
import { InboxActions } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "提醒 - VIPRPG.org" };

export default async function InboxPage({ searchParams }: {
  searchParams: Promise<Record<string,string|string[]|undefined>>;
}) {
  const params = await searchParams;
  const category = inboxCategory(params.category);
  const unread = params.unread === "1";
  const page = forumPage(params.page);
  const currentUser = await getCurrentUserFromCookies();
  if (!currentUser) redirect(`/login?next=${encodeURIComponent(inboxHref(category,unread,page))}`);
  const canResolve = canResolveInboxRequests(currentUser);
  if (category === "pending" && !canResolve) redirect(inboxHref("all",unread));
  const result = await listInboxItemsForUser(currentUser,{category,unread,page});
  if (page !== result.page) redirect(inboxHref(category,unread,result.page));
  return (
    <main className="mx-auto w-[min(1280px,calc(100%-2rem))] min-w-0 py-8">
      <PageHeader compact title={<span>提醒{result.unread > 0 ? <span className="ml-3 align-middle font-sans text-sm font-normal text-muted">{formatUnreadCount(result.unread)} 未读</span> : null}</span>}
        actions={result.unread > 0 ? <InboxActions all /> : null} />
      <InboxControls category={category} unread={unread} pendingCount={result.pending} canResolve={canResolve} />
      <InboxFeedback />
      {result.items.length ? <ul aria-label="提醒列表" className="divide-y divide-border border-b border-border">
        {result.items.map((item) => <InboxRow key={item.id} item={item} />)}
      </ul> : <EmptyState title={emptyLabel(category,unread)} />}
      <PaginationLinks basePath="/inbox" page={result.page} pageSize={result.pageSize} total={result.total} prefetch={false}
        params={{ category:category === "all" ? undefined : category,unread:unread ? "1" : undefined }} />
    </main>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  const interaction = item.interaction;
  const Icon = item.type === "forum_like" ? Heart : item.type === "forum_reply" ? MessageCircle : item.type === "role_change_request" ? ShieldCheck : Bell;
  const approvalLabels = {pending:"待审核",approved:"已通过",rejected:"已驳回",open:"待审核",archived:"已归档"};
  return (
    <li className={`grid min-w-0 grid-cols-[36px_minmax(0,1fr)] gap-x-3 gap-y-2 px-2 py-4 hover:bg-primary/5 focus-within:bg-primary/5 sm:grid-cols-[36px_minmax(0,1fr)_auto] sm:px-3 ${item.readAt ? "" : "bg-primary/[0.03]"}`}>
      <div className="relative row-span-2 self-start">
        {interaction ? <UserAvatar displayName={interaction.actorName} avatarBlobSha256={interaction.actorAvatar} size={36} className="size-9" />
          : <span className="grid size-9 place-items-center rounded-md bg-muted/10"><Icon className="size-4 text-muted" aria-hidden /></span>}
        {!item.readAt ? <span className="absolute -left-1 -top-1 size-2 rounded-full bg-primary"><span className="sr-only">未读</span></span> : null}
      </div>
      <div className="min-w-0 break-words [overflow-wrap:anywhere]">
        {interaction ? <>
          <p className={`text-sm ${item.readAt ? "" : "font-semibold"}`}>
            {interaction.actorHref ? <Link className="hover:underline focus-visible:outline-2 focus-visible:outline-primary" href={interaction.actorHref}>{interaction.actorName}</Link> : interaction.actorName}
            <span>{interaction.action}</span>
          </p>
          <Link href={`/inbox/${item.id}`} prefetch={false} className="mt-1 block rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <span className="line-clamp-2 font-semibold text-primary hover:underline">{interaction.topicTitle}</span>
            <span className="mt-1 block text-xs text-muted">第 {interaction.postNumber} 楼{interaction.commentId ? " · 楼中楼" : ""}</span>
            {interaction.excerpt ? <span className="mt-2 line-clamp-2 text-foreground">{interaction.excerpt}</span> : null}
          </Link>
        </> : <>
          <p className={`text-sm ${item.readAt ? "" : "font-semibold"}`}>{item.title}</p>
          {item.type === "role_change_request" ? <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{item.targetDisplayName} · {item.requestedRole?.name}</span>
            <Badge variant="outline">{approvalLabels[item.status]}</Badge>
          </div> : null}
          {item.body ? <p className="mt-2 whitespace-pre-wrap text-sm">{item.body}</p> : null}
        </>}
      </div>
      <time dateTime={utcDate(item.createdAt).toISOString()} title={formatDate(item.createdAt,{time:true})}
        className="col-start-2 text-xs text-muted sm:col-start-3 sm:row-start-1 sm:text-right">
        {relativeTime(item.createdAt)}
      </time>
      <div className="col-start-2 sm:col-start-3 sm:row-start-2"><InboxActions item={{
        id:item.id,readAt:item.readAt,canApprove:item.canApprove,canReject:item.canReject,
      }} /></div>
    </li>
  );
}

function utcDate(value: string) { return new Date(value.includes("T") ? value : value.replace(" ","T")+"Z"); }
function relativeTime(value: string) {
  const minutes = Math.max(0,Math.floor((Date.now()-utcDate(value).getTime())/60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes/60)}小时前`;
  if (minutes < 10080) return `${Math.floor(minutes/1440)}天前`;
  return formatDate(value);
}
function emptyLabel(category: InboxCategory, unread: boolean) {
  if (unread) return "没有未读提醒";
  return {all:"暂无提醒",replies:"还没有收到回复",likes:"还没有收到赞",system:"暂无系统通知",pending:"暂无待处理申请"}[category];
}
