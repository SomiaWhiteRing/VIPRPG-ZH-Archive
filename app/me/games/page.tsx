import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { listMyComments, listMyPlayed, listMyWishlist } from "@/lib/server/db/work-community";

export const dynamic = "force-dynamic";

export default async function MyGamesPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect(`/login?next=${encodeURIComponent("/me/games")}`);
  const [played, comments, wishlist] = await Promise.all([
    listMyPlayed(user.id),
    listMyComments(user.id, null),
    listMyWishlist(user.id),
  ]);
  return (
    <main>
      <PageHeader title="我的游戏记录" />
      <div className="grid gap-5 lg:grid-cols-3">
        <RecordPane heading="最近游玩" empty="还没有游玩记录。">
          {played.map((item) => <RecordLink href={`/games/${item.workId}`} key={`${item.workId}-${item.occurredAt}`} title={item.title} time={item.occurredAt} />)}
        </RecordPane>
        <RecordPane heading="我的评论" empty="还没有评论。">
          {comments.items.map((item) => <RecordLink href={`/games/${item.workId}#comment-${item.id}`} key={item.id} title={`#${item.id} · ${item.rootDeleted ? "主楼已删除" : "评论"}`} time={item.updatedAt} />)}
        </RecordPane>
        <RecordPane heading="待玩" empty="待玩清单为空。">
          {wishlist.map((item) => <RecordLink href={`/games/${item.workId}`} key={`${item.workId}-${item.occurredAt}`} title={item.title} time={item.occurredAt} />)}
        </RecordPane>
      </div>
    </main>
  );
}

function RecordPane({ heading, empty, children }: { heading: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return <Pane heading={heading}>{items.length ? <ul className="grid gap-3">{items.map((item) => <li key={(item as React.ReactElement).key}>{item}</li>)}</ul> : <p className="text-sm text-muted">{empty}</p>}</Pane>;
}

function RecordLink({ href, title, time }: { href: string; title: string; time: string }) {
  return <Link className="grid gap-1" href={href}><strong>{title}</strong><span className="text-sm text-muted">{new Date(time).toLocaleString("zh-CN")}</span></Link>;
}
