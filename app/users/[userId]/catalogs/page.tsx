import { CatalogSummaryList } from "@/app/components/profile/catalog-summary-list";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { parseAccountPage } from "@/lib/server/auth/account-user";
import { searchCatalogsForOwner } from "@/lib/server/db/catalogs";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { requirePublicProfileSection } from "../public-user";
export const dynamic = "force-dynamic";
export default async function PublicCatalogs({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ page?: string | string[] }> }) { const user = await requirePublicProfileSection((await params).userId, "catalogs"); const page = parseAccountPage((await searchParams).page); const result = await searchCatalogsForOwner({ userId: user.id, page, pageSize: 20 }); const base = `/users/${user.id}/catalogs`; return <section><h2>公开目录</h2>{result.items.length ? <CatalogSummaryList items={result.items}  /> : <AccountEmpty>还没有公开目录。</AccountEmpty>}<PaginationLinks basePath={base} page={page} pageSize={result.pageSize} total={result.total} /></section>; }
