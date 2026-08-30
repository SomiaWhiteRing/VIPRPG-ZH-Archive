import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { CatalogCreateForm } from "@/app/catalogs/catalog-manager";
import { requireAccountUser, parseAccountPage } from "@/lib/server/auth/account-user";
import { searchCatalogsForOwner } from "@/lib/server/db/catalogs";
import { formatDate } from "@/lib/format";
import { AccountEmpty } from "../account-content";

export const dynamic = "force-dynamic";
export default async function MyCatalogsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(`/me/catalogs${page > 1 ? `?page=${page}` : ""}`);
  const result = await searchCatalogsForOwner({ userId: user.id, page, pageSize: 20 });
  return <div className="grid gap-6"><PageHeader title="我的目录" subtitle={`共 ${result.total} 个公开目录`} /><CatalogCreateForm />{result.items.length ? <ul className="divide-y divide-border border-y border-border">{result.items.map((catalog) => <li className="grid gap-1 py-4" key={catalog.id}><Link className="font-semibold" href={`/catalogs/${catalog.id}`}>{catalog.title}</Link><p className="m-0 text-sm text-muted">{catalog.description || "未填写说明。"}</p><span className="text-xs text-muted">{catalog.itemCount} 部作品 · 更新于 {formatDate(catalog.updatedAt)}</span></li>)}</ul> : <AccountEmpty>还没有目录，可以在上方创建。</AccountEmpty>}<PaginationLinks basePath="/me/catalogs" page={page} hasNext={page * 20 < result.total} /></div>;
}
