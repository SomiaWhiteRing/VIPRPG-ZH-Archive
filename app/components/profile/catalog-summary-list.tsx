import { CatalogListRow } from "@/app/catalogs/catalog-list-row";
import type { CatalogSummary } from "@/lib/dto/db/catalogs";
import type { ReactNode } from "react";

export function CatalogSummaryList({
  items,
  showDescription = false,
  preview = false,
  renderActions,
}: {
  items: CatalogSummary[];
  showDescription?: boolean;
  preview?: boolean;
  renderActions?: (catalog: CatalogSummary) => ReactNode;
}) {
  return (
    <ul className={`divide-y divide-border border-border ${preview ? "border-t" : "border-b"}`}>
      {items.map((catalog, index) => (
        <li
          className={preview && index >= 2 ? "hidden sm:block" : undefined}
          key={catalog.id}
        >
          <CatalogListRow
            catalog={catalog}
            showDescription={showDescription}
            showOwner={false}
            showCreatedAt={false}
            actions={renderActions?.(catalog)}
          />
        </li>
      ))}
    </ul>
  );
}
