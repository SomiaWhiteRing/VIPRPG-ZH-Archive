import {
  parseAccountPage,
  requireAccountUser,
} from "@/app/.server/auth/account-user";
import { searchUserWorks } from "@/app/.server/db/game-library";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { FavoriteGrid } from "../favorite-grid";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(
    runtime,
    `/me/favorites${page > 1 ? `?page=${page}` : ""}`,
  );
  const result = await searchUserWorks(runtime, {
    userId: user.id,
    kind: "favorite",
    page,
    pageSize: 20,
  });

  return { page, result };
}

export default function FavoritesPage() {
  const { page, result } = useLoaderData<typeof loader>();
  return (
    <div>
      <PageHeader title="收藏" subtitle={`共 ${result.total} 部作品`} />
      {result.items.length ? (
        <FavoriteGrid items={result.items} />
      ) : (
        <AccountEmpty>还没有收藏作品。</AccountEmpty>
      )}
      <PaginationLinks
        basePath="/me/favorites"
        page={page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
