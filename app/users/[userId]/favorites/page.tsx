import { parseAccountPage } from "@/app/.server/auth/account-user";
import { searchUserWorks } from "@/app/.server/db/game-library";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { GameCard } from "@/app/components/home/game-card";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);
  const user = await requirePublicProfileSection(
    runtime,
    (await params).userId,
    "favorites",
  );
  const page = parseAccountPage((await searchParams).page);
  const result = await searchUserWorks(runtime, {
    userId: user.id,
    kind: "favorite",
    page,
    pageSize: 20,
  });
  const base = `/users/${user.id}/favorites`;
  return { page, result, base };
}

export default function PublicFavorites() {
  const { page, result, base } = useLoaderData<typeof loader>();
  return (
    <section>
      <h2>收藏</h2>
      {result.items.length ? (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {result.items.map(({ work }) => (
            <li key={work.id}>
              <GameCard work={work} />
            </li>
          ))}
        </ul>
      ) : (
        <AccountEmpty>还没有公开收藏。</AccountEmpty>
      )}
      <PaginationLinks
        basePath={base}
        page={page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </section>
  );
}
