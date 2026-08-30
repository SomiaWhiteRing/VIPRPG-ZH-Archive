import { PageHeader } from "@/app/components/ui/page-header";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { GameCard } from "@/app/components/home/game-card";
import { requireAccountUser, parseAccountPage } from "@/lib/server/auth/account-user";
import { searchUserWorks } from "@/lib/server/db/game-library";
import { AccountEmpty } from "../account-content";
export const dynamic = "force-dynamic";
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const page = parseAccountPage((await searchParams).page); const user = await requireAccountUser(`/me/history${page > 1 ? `?page=${page}` : ""}`); const result = await searchUserWorks({ userId: user.id, kind: "played", page, pageSize: 20 });
  return <div><PageHeader title="游玩历史" subtitle={`共 ${result.total} 部作品，每部作品只保留最近一次游玩时间。`} />{result.items.length ? <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3">{result.items.map(({ work }) => <li key={work.id}><GameCard work={work} /></li>)}</ul> : <AccountEmpty>还没有游玩记录。</AccountEmpty>}<PaginationLinks basePath="/me/history" page={page} hasNext={page * 20 < result.total} /></div>;
}
