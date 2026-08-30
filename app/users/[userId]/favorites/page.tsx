import { GameCard } from "@/app/components/home/game-card";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { parseAccountPage } from "@/lib/server/auth/account-user";
import { searchUserWorks } from "@/lib/server/db/game-library";
import { AccountEmpty } from "@/app/me/account-content";
import { requirePublicUser } from "../public-user";
export const dynamic = "force-dynamic";
export default async function PublicFavorites({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ page?: string | string[] }> }) { const user = await requirePublicUser((await params).userId); const page = parseAccountPage((await searchParams).page); const result = await searchUserWorks({ userId: user.id, kind: "favorite", page, pageSize: 20 }); const base = `/users/${user.id}/favorites`; return <section><h2>收藏</h2>{result.items.length ? <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{result.items.map(({ work }) => <li key={work.id}><GameCard work={work} /></li>)}</ul> : <AccountEmpty>还没有公开收藏。</AccountEmpty>}<PaginationLinks basePath={base} page={page} hasNext={page * 20 < result.total} /></section>; }
