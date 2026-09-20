import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import type { CatalogSummary } from "@/lib/dto/db/catalogs";
import { Link } from "react-router";

export function CatalogCover({
  catalog,
  className = "w-26 sm:w-32",
}: {
  catalog: CatalogSummary;
  className?: string;
}) {
  return (
    <Link
      aria-label={`查看目录：${catalog.title}`}
      className={`group relative block aspect-4/3 shrink-0 overflow-hidden rounded-md border border-border bg-muted/15 ${className}`}
      to={`/catalogs/${catalog.id}`}
    >
      <WorkThumbnail
        blobSha256={catalog.coverBlobSha256}
        width={128}
        height={96}
        imageClassName="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
        fallback="暂无封面"
        fallbackClassName="flex h-full items-center justify-center px-1 text-center font-mono text-[10.5px] text-muted"
      />
    </Link>
  );
}
