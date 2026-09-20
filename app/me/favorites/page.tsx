import { requireAccountUser } from "@/app/.server/auth/account-user";
import { loadGameLibrary } from "@/app/.server/game-library-page";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { FavoriteLibrary } from "@/app/me/favorite-library";
import { PageHeader } from "@/app/components/ui/page-header";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);
  const url = new URL(args.request.url);
  const user = await requireAccountUser(runtime, `/me/favorites${url.search}`);
  return loadGameLibrary(runtime, searchParams, { userId: user.id, kind: "favorite" });
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: "我的收藏", page: loaderData?.page }, error);

export default function FavoritesPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <div>
      <PageHeader title="收藏" subtitle={`共 ${data.total} 部作品`} />
      <FavoriteLibrary data={data} />
    </div>
  );
}
