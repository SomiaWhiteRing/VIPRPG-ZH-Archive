import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { listCatalogs } from "@/app/.server/db/catalogs";
import { runtimeContext } from "@/app/.server/router-context";
import { CatalogListRow } from "@/app/catalogs/catalog-list-row";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const catalogs = await listCatalogs(runtime);

  return { catalogs };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: "目录" }, error);

export default function CatalogsPage() {
  const { catalogs } = useLoaderData<typeof loader>();
  return (
    <PageContainer>
      <PageHeader
        compact
        title="目录"
        subtitle="玩家创建的游戏整理与阅读顺序。"
      />
      {catalogs.length ? (
        <section
          aria-label="目录列表"
          className="mt-5 divide-y divide-border border-y border-border"
        >
          {catalogs.map((catalog) => (
            <CatalogListRow catalog={catalog} key={catalog.id} />
          ))}
        </section>
      ) : (
        <div className="mt-5">
          <EmptyState title="还没有公开目录。" />
        </div>
      )}
    </PageContainer>
  );
}
