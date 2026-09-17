import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import {
  parseAccountPage,
  requireAccountUser,
} from "@/app/.server/auth/account-user";
import { searchUserWorks } from "@/app/.server/db/game-library";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { GameCard } from "@/app/components/home/game-card";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(
    runtime,
    `/me/history${page > 1 ? `?page=${page}` : ""}`,
  );
  const result = await searchUserWorks(runtime, {
    userId: user.id,
    kind: "played",
    page,
    pageSize: 20,
  });

  return { page, result };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: "游玩历史", page: loaderData?.page }, error);

export default function HistoryPage() {
  const { page, result } = useLoaderData<typeof loader>();
  return (
    <div>
      <PageHeader
        title="游玩历史"
        subtitle={`共 ${result.total} 部作品，每部作品只保留最近一次游玩时间。`}
      />
      {result.items.length ? (
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {result.items.map(({ work }) => (
            <li key={work.id}>
              <GameCard work={work} />
            </li>
          ))}
        </ul>
      ) : (
        <AccountEmpty>还没有游玩记录。</AccountEmpty>
      )}
      <PaginationLinks
        basePath="/me/history"
        page={page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
