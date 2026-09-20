import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import {
  parseAccountPage,
  requireAccountUser,
} from "@/app/.server/auth/account-user";
import { searchCatalogsForOwner } from "@/app/.server/db/catalogs";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { CatalogCreateForm } from "@/app/catalogs/catalog-manager";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { CatalogSummaryList } from "@/app/components/profile/catalog-summary-list";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(
    runtime,
    `/me/catalogs${page > 1 ? `?page=${page}` : ""}`,
  );
  const result = await searchCatalogsForOwner(runtime, {
    userId: user.id,
    page,
    pageSize: 20,
  });

  return { page, result };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: "我的目录", page: loaderData?.page }, error);

export default function MyCatalogsPage() {
  const { page, result } = useLoaderData<typeof loader>();
  return (
    <div className="grid gap-6">
      <PageHeader
        actions={<CatalogCreateForm />}
        title="我的目录"
        subtitle={`共 ${result.total} 个公开目录`}
      />
      {result.items.length ? (
        <CatalogSummaryList items={result.items} showDescription />
      ) : (
        <AccountEmpty>暂无目录</AccountEmpty>
      )}
      <PaginationLinks
        basePath="/me/catalogs"
        page={page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
