import { CatalogListRow } from "@/app/catalogs/catalog-list-row";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { listCatalogs } from "@/lib/server/db/catalogs";

export const dynamic = "force-dynamic";
export default async function CatalogsPage() {
  const catalogs = await listCatalogs();
  return (
    <main className="mx-auto w-[min(1280px,calc(100vw-2rem))] py-5 sm:py-8">
      <PageHeader compact title="目录" subtitle="玩家创建的游戏整理与阅读顺序。" />
      {catalogs.length ? (
        <section aria-label="目录列表" className="mt-5 divide-y divide-border border-y border-border">
          {catalogs.map((catalog) => (
            <CatalogListRow catalog={catalog} key={catalog.id} />
          ))}
        </section>
      ) : (
        <div className="mt-5">
          <EmptyState title="还没有公开目录。" />
        </div>
      )}
    </main>
  );
}
