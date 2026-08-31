import Link from "next/link";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { parseAccountPage } from "@/lib/server/auth/account-user";
import { searchCatalogsForOwner } from "@/lib/server/db/catalogs";
import { formatDate } from "@/lib/format";
import { AccountEmpty } from "@/app/me/account-content";
import { requirePublicProfileSection } from "../public-user";
export const dynamic = "force-dynamic";
export default async function PublicCatalogs({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ page?: string | string[] }> }) { const user = await requirePublicProfileSection((await params).userId, "catalogs"); const page = parseAccountPage((await searchParams).page); const result = await searchCatalogsForOwner({ userId: user.id, page, pageSize: 20 }); const base = `/users/${user.id}/catalogs`; return <section><h2>公开目录</h2>{result.items.length ? <ul className="divide-y divide-border border-y border-border">{result.items.map((catalog) => <li className="py-4" key={catalog.id}><Link className="font-semibold" href={`/catalogs/${catalog.id}`}>{catalog.title}</Link><p className="text-sm text-muted">{catalog.itemCount} 部作品 · 更新于 {formatDate(catalog.updatedAt)}</p></li>)}</ul> : <AccountEmpty>还没有公开目录。</AccountEmpty>}<PaginationLinks basePath={base} page={page} hasNext={page * 20 < result.total} /></section>; }
