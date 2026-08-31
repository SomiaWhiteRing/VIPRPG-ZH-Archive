import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { engineLabel, languageLabel } from "@/lib/labels";
import type { CatalogItem } from "@/lib/server/db/catalogs";

export function CatalogGameListItem({
  index,
  item,
  management,
}: {
  index: number;
  item: CatalogItem;
  management?: ReactNode;
}) {
  const href = `/games/${item.workId}`;
  const metadata = [
    item.originalReleaseDate,
    engineLabel(item.engineFamily),
    languageLabel(item.language),
  ].filter(Boolean);

  return (
    <li className="flex items-start gap-3 py-4 sm:gap-4">
      <span className="w-6 shrink-0 pt-1 text-right font-mono text-xs text-muted">
        {String(index + 1).padStart(2, "0")}
      </span>
      <Link
        aria-label={`查看游戏：${item.title}`}
        className="group relative block aspect-4/3 w-24 shrink-0 overflow-hidden rounded-md border border-border bg-muted/15 sm:w-32"
        href={href}
      >
        {item.previewBlobSha256 ? (
          <Image
            alt=""
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
            height={96}
            src={`/api/media/blobs/${item.previewBlobSha256}`}
            unoptimized
            width={128}
          />
        ) : (
          <span className="flex h-full items-center justify-center px-1 text-center font-mono text-[10px] text-muted">
            {engineLabel(item.engineFamily)}
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <Link
            className="min-w-0 flex-1 text-[15.5px] font-bold leading-[1.45] hover:text-primary hover:underline hover:underline-offset-3"
            href={href}
          >
            {item.title}
          </Link>
          {management ? <div className="shrink-0">{management}</div> : null}
        </div>
        {item.chineseTitle ? (
          <p className="mt-0.5 text-[12.5px] text-muted">{item.originalTitle}</p>
        ) : null}
        <p className="mt-1 font-mono text-xs text-muted">{metadata.join(" / ")}</p>
        {item.note ? (
          <p className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/5 px-3 py-2 text-[13px] leading-[1.6]">
            {item.note}
          </p>
        ) : null}
      </div>
    </li>
  );
}
