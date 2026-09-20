import { CatalogListRow } from "@/app/catalogs/catalog-list-row";
import type { CatalogSummary } from "@/lib/dto/db/catalogs";

export function CatalogSummaryList({
  items,
  showDescription = false,
  preview = false,
}: {
  items: CatalogSummary[];
  showDescription?: boolean;
  preview?: boolean;
}) {
  return (
    <ul className="divide-y divide-border border-y border-border">
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
          />
        </li>
      ))}
    </ul>
  );
}
