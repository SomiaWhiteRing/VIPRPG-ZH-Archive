import { PageHeader } from "@/app/components/ui/page-header";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { requireAccountUser, parseAccountPage } from "@/lib/server/auth/account-user";
import { searchUserWorks } from "@/lib/server/db/game-library";
import { AccountEmpty } from "../account-content";
import { FavoriteGrid } from "../favorite-grid";
export const dynamic = "force-dynamic";
export default async function FavoritesPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const page = parseAccountPage((await searchParams).page); const user = await requireAccountUser(`/me/favorites${page > 1 ? `?page=${page}` : ""}`); const result = await searchUserWorks({ userId: user.id, kind: "favorite", page, pageSize: 20 });
  return <div><PageHeader title="收藏" subtitle={`共 ${result.total} 部作品`} />{result.items.length ? <FavoriteGrid items={result.items} /> : <AccountEmpty>还没有收藏作品。</AccountEmpty>}<PaginationLinks basePath="/me/favorites" page={page} pageSize={result.pageSize} total={result.total} /></div>;
}
