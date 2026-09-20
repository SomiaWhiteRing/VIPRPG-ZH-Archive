import { CatalogCover } from "@/app/catalogs/catalog-cover";
import type { CatalogSummary } from "@/lib/dto/db/catalogs";
import { formatDate, formatNumber } from "@/lib/format";
import { Link } from "react-router";

export function CatalogListRow({
  catalog,
  compact = false,
  showDescription = !compact,
  showOwner = true,
  showCreatedAt = !compact,
}: {
  catalog: CatalogSummary;
  compact?: boolean;
  showDescription?: boolean;
  showOwner?: boolean;
  showCreatedAt?: boolean;
}) {
  const href = `/catalogs/${catalog.id}`;

  return (
    <article className={compact ? "flex items-start gap-2.5 py-2" : "flex items-start gap-3.5 py-3.5"}>
      <CatalogCover catalog={catalog} className={compact ? "w-16" : "w-26 sm:w-32"} />
      <div className="min-w-0 flex-1 wrap-anywhere">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link
            className={`${compact ? "text-sm" : "text-[15.5px]"} font-bold leading-[1.45] hover:text-primary hover:underline hover:underline-offset-3`}
            to={href}
          >
            {catalog.title}
          </Link>
          <span className="font-mono text-[11.5px] text-muted">
            {formatNumber(catalog.itemCount)} 部作品
          </span>
        </div>
        {showDescription ? <p className="mt-1 line-clamp-2 text-[13px] leading-[1.55] text-muted">
          {catalog.description || "未填写说明。"}
        </p> : null}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          {showOwner ? <span>
            {!compact ? "创建者 " : null}
            <Link
              className="font-semibold text-primary hover:underline hover:underline-offset-2"
              to={`/users/${catalog.ownerUserId}`}
            >
              {catalog.ownerName}
            </Link>
          </span> : null}
          {showCreatedAt ? <span>
            创建于{" "}
            <time className="font-mono" dateTime={catalog.createdAt}>
              {formatDate(catalog.createdAt)}
            </time>
          </span> : null}
          {!compact ? <span>
            更新于{" "}
            <time className="font-mono" dateTime={catalog.updatedAt}>
              {formatDate(catalog.updatedAt)}
            </time>
          </span> : null}
        </div>
      </div>
    </article>
  );
}
