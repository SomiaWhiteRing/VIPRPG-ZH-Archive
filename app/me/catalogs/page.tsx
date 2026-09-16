import { CatalogSummaryList } from "@/app/components/profile/catalog-summary-list";
import { PageHeader } from "@/app/components/ui/page-header";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { CatalogCreateForm } from "@/app/catalogs/catalog-manager";
import { requireAccountUser, parseAccountPage } from "@/lib/server/auth/account-user";
import { searchCatalogsForOwner } from "@/lib/server/db/catalogs";
import { AccountEmpty } from "@/app/components/profile/account-content";

export const dynamic = "force-dynamic";
export default async function MyCatalogsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(`/me/catalogs${page > 1 ? `?page=${page}` : ""}`);
  const result = await searchCatalogsForOwner({ userId: user.id, page, pageSize: 20 });
  return <div className="grid gap-6"><PageHeader title="我的目录" subtitle={`共 ${result.total} 个公开目录`} /><CatalogCreateForm />{result.items.length ? <CatalogSummaryList items={result.items} showDescription /> : <AccountEmpty>还没有目录，可以在上方创建。</AccountEmpty>}<PaginationLinks basePath="/me/catalogs" page={page} pageSize={result.pageSize} total={result.total} /></div>;
}
