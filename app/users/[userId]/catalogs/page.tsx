import { parseAccountPage } from "@/app/.server/auth/account-user";
import { searchCatalogsForOwner } from "@/app/.server/db/catalogs";
import { requirePublicProfileSection } from "@/app/.server/public-user";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { CatalogSummaryList } from "@/app/components/profile/catalog-summary-list";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);
  const user = await requirePublicProfileSection(
    runtime,
    (await params).userId,
    "catalogs",
  );
  const page = parseAccountPage((await searchParams).page);
  const result = await searchCatalogsForOwner(runtime, {
    userId: user.id,
    page,
    pageSize: 20,
  });
  const base = `/users/${user.id}/catalogs`;
  return { page, result, base };
}

export default function PublicCatalogs() {
  const { page, result, base } = useLoaderData<typeof loader>();
  return (
    <section>
      <h2>公开目录</h2>
      {result.items.length ? (
        <CatalogSummaryList items={result.items} />
      ) : (
        <AccountEmpty>还没有公开目录。</AccountEmpty>
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
