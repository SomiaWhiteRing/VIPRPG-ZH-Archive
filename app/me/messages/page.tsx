import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useState } from "react";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { listDirectConversations } from "@/app/.server/db/messages";
import { parsePageId } from "@/app/.server/http/page-response";
import { runtimeContext } from "@/app/.server/router-context";
import { Button } from "@/app/components/ui/button";
import { UnreadBadge } from "@/app/components/ui/unread-badge";
import { useToast } from "@/app/components/ui/toast";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Timestamp } from "@/app/components/ui/timestamp";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { requestJson } from "@/lib/ui/api-response";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const user = await requireAccountUser(runtime, "/me/messages");
  const before = new URL(args.request.url).searchParams.get("before");
  return listDirectConversations(runtime, user, before === null ? undefined : parsePageId(before));
}

export const meta: MetaFunction = ({ error }) => pageMetaDescriptors({ title: ["短信箱", "个人中心"] }, error);

export default function MessagesPage() {
  const initial = useLoaderData<typeof loader>();
  const [snapshot, setSnapshot] = useState({ initial, data: initial });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const { conversations, nextCursor } = snapshot.initial === initial ? snapshot.data : initial;
  const toast = useToast();

  async function older() {
    if (loadingOlder || nextCursor === null) return;
    setLoadingOlder(true);
    try {
      const next = await requestJson<typeof initial>(`/api/messages/conversations?before=${nextCursor}`, { cache: "no-store" });
      setSnapshot({ initial, data: { conversations: [...conversations, ...next.conversations], nextCursor: next.nextCursor } });
    } catch (error) { toast.error(error instanceof Error ? error.message : "读取失败"); }
    finally { setLoadingOlder(false); }
  }
  return <>
    <AccountPageHeader title="短信箱" />
    {conversations.length ? <ul className="mt-4 divide-y divide-border">
      {conversations.map(conversation => <li key={conversation.peer.id}>
        <Link to={`/me/messages/${conversation.peer.id}`} prefetch="none" className="flex min-w-0 items-center gap-3 rounded-md px-2 py-4 hover:bg-muted/10 focus-visible:outline-2 focus-visible:outline-primary">
          <UserAvatar avatarBlobSha256={conversation.peer.avatarBlobSha256} displayName={conversation.peer.displayName} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3"><strong className="truncate text-sm">{conversation.peer.displayName}</strong><Timestamp className="shrink-0 text-muted" value={conversation.updatedAt} /></div>
            <p className="m-0 mt-1 truncate text-sm text-muted">{conversation.excerpt}</p>
          </div>
          <UnreadBadge count={conversation.unread} />
        </Link>
      </li>)}
    </ul> : <EmptyState className="mt-6" title="暂无短信" />}
    {nextCursor !== null ? <div className="mt-4 text-center"><Button type="button" variant="ghost" size="sm" disabled={loadingOlder} onClick={() => void older()}>更早的会话</Button></div> : null}
  </>;
}
