import Link from "next/link";
import { searchUserWorks } from "@/lib/server/db/game-library";
import { searchCatalogsForOwner } from "@/lib/server/db/catalogs";
import { searchUserComments } from "@/lib/server/db/work-community";
import { formatDate } from "@/lib/format";
import { AccountEmpty, AccountSection, AccountWorkGrid } from "@/app/me/account-content";
import { requirePublicUser } from "./public-user";

export const dynamic = "force-dynamic";
export default async function PublicUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const user = await requirePublicUser((await params).userId); const base = `/users/${user.id}`;
  const [favorites, played, catalogs, comments] = await Promise.all([
    searchUserWorks({ userId: user.id, kind: "favorite", pageSize: 4 }),
    searchUserWorks({ userId: user.id, kind: "played", pageSize: 4 }),
    searchCatalogsForOwner({ userId: user.id, pageSize: 3 }),
    searchUserComments({ userId: user.id, publicOnly: true, pageSize: 3 }),
  ]);
  return <div className="grid gap-7"><AccountSection href={`${base}/history`} title="最近游玩">{played.items.length ? <AccountWorkGrid items={played.items} /> : <AccountEmpty>还没有公开游玩记录。</AccountEmpty>}</AccountSection><AccountSection href={`${base}/favorites`} title="最近收藏">{favorites.items.length ? <AccountWorkGrid items={favorites.items} /> : <AccountEmpty>还没有公开收藏。</AccountEmpty>}</AccountSection><AccountSection href={`${base}/catalogs`} title="公开目录">{catalogs.items.length ? <ul className="divide-y divide-border border-y border-border">{catalogs.items.map((catalog, index) => <li className={`py-3 ${index >= 2 ? "hidden sm:block" : ""}`} key={catalog.id}><Link className="font-semibold" href={`/catalogs/${catalog.id}`}>{catalog.title}</Link><p className="mt-1 text-sm text-muted">{catalog.itemCount} 部作品 · {formatDate(catalog.updatedAt)}</p></li>)}</ul> : <AccountEmpty>还没有公开目录。</AccountEmpty>}</AccountSection><AccountSection href={`${base}/comments`} title="最近评论">{comments.items.length ? <ul className="divide-y divide-border border-y border-border">{comments.items.map((comment, index) => <li className={`py-3 ${index >= 2 ? "hidden sm:block" : ""}`} key={comment.id}><Link className="font-semibold" href={`/games/${comment.workId}#comment-${comment.id}`}>{comment.workTitle}</Link><p className="mt-1 line-clamp-2 text-sm text-muted">{comment.body}</p></li>)}</ul> : <AccountEmpty>还没有公开评论。</AccountEmpty>}</AccountSection></div>;
}
