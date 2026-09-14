import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { getInboxItemForUser, inboxTargetLocation } from "@/lib/server/db/inbox";
import { HttpError } from "@/lib/server/http/json";
import { PageHeader } from "@/app/components/ui/page-header";
import { InboxActions } from "../actions";
import { InboxFeedback } from "../controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "提醒 - VIPRPG.org", robots: { index: false, follow: false } };

export default async function InboxTargetPage({ params }: { params: Promise<{itemId:string}> }) {
  const {itemId} = await params;
  if (!/^[1-9]\d*$/.test(itemId) || !Number.isSafeInteger(Number(itemId))) notFound();
  const user = await getCurrentUserFromCookies();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/inbox/${itemId}`)}`);
  const item = await getInboxItemForUser(Number(itemId),user).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  });
  const location = await inboxTargetLocation(item);
  if (location) {
    const [path,hash] = location.href.split("#");
    redirect(`${path}${path.includes("?") ? "&" : "?"}inbox=${item.id}${hash ? `#${hash}` : ""}`);
  }
  return <main className="mx-auto w-[min(1280px,calc(100%-2rem))] py-8">
    <div id="inbox-controls" tabIndex={-1} className="mb-4"><Link href="/inbox" className="text-sm text-primary hover:underline">返回提醒</Link></div>
    <PageHeader compact title="提醒" />
    <InboxFeedback />
    <p className="py-6">{item.type.startsWith("forum_") ? "相关内容已不可用" : item.title}</p>
    <InboxActions item={{id:item.id,readAt:item.readAt,canApprove:item.canApprove,canReject:item.canReject}} />
  </main>;
}
