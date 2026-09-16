import Link from "next/link";
import { formatDate } from "@/lib/format";
import type { CatalogSummary } from "@/lib/server/db/catalogs";

export function CatalogSummaryList({ items, showDescription = false }: { items: CatalogSummary[]; showDescription?: boolean }) {
  return <ul className="divide-y divide-border border-y border-border">
    {items.map((catalog) => <li className="grid gap-1 py-4" key={catalog.id}>
      <Link className="font-semibold" href={`/catalogs/${catalog.id}`}>{catalog.title}</Link>
      {showDescription ? <p className="m-0 text-sm text-muted">{catalog.description || "未填写说明。"}</p> : null}
      <span className="text-xs text-muted">{catalog.itemCount} 部作品 · 更新于 {formatDate(catalog.updatedAt)}</span>
    </li>)}
  </ul>;
}
