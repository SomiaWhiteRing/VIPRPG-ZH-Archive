import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import {
  requireAccountUser,
} from "@/app/.server/auth/account-user";
import { loadGameLibrary } from "@/app/.server/game-library-page";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { GameLibrary } from "@/app/components/library/game-library";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const url = new URL(args.request.url);
  const user = await requireAccountUser(
    runtime,
    `/me/history${url.search}`,
  );
  return loadGameLibrary(runtime, searchParams, { userId: user.id, kind: "played" });
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: "游玩历史", page: loaderData?.page }, error);

export default function HistoryPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div>
      <PageHeader
        title="游玩历史"
        subtitle={`共 ${data.total} 部作品`}
      />
      <GameLibrary data={data} basePath="/me/history" emptyTitle="还没有游玩记录。" />
    </div>
  );
}
