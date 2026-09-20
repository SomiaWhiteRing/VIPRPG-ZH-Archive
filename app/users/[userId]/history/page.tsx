import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { loadGameLibrary } from "@/app/.server/game-library-page";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { GameLibrary } from "@/app/components/library/game-library";
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
  const data = await loadGameLibrary(runtime, searchParams, { userId: user.id, kind: "played" });
  const base = `/users/${user.id}/history`;
  return { ...data, displayName: user.displayName, base };
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
  const data = useLoaderData<typeof loader>();
  return (
    <section aria-label="最近游玩">
      <GameLibrary data={data} basePath={data.base} emptyTitle="还没有公开游玩记录。" />
    </section>
  );
}
