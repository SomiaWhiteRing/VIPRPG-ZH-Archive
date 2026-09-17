import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { parseAccountPage } from "@/app/.server/auth/account-user";
import { searchUserWorks } from "@/app/.server/db/game-library";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { GameCard } from "@/app/components/home/game-card";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);
  const user = await requirePublicProfileSection(
    runtime,
    (await params).userId,
    "history",
  );
  const page = parseAccountPage((await searchParams).page);
  const result = await searchUserWorks(runtime, {
    userId: user.id,
    kind: "played",
    page,
    pageSize: 20,
  });
  const base = `/users/${user.id}/history`;
  return { displayName: user.displayName, page, result, base };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    {
      title: [loaderData?.displayName || "用户", "游玩历史"],
      page: loaderData?.page,
    },
    error,
  );

export default function PublicHistory() {
  const { page, result, base } = useLoaderData<typeof loader>();
  return (
    <section>
      <h2>最近游玩</h2>
      {result.items.length ? (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {result.items.map(({ work }) => (
            <li key={work.id}>
              <GameCard work={work} />
            </li>
          ))}
        </ul>
      ) : (
        <AccountEmpty>还没有公开游玩记录。</AccountEmpty>
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
