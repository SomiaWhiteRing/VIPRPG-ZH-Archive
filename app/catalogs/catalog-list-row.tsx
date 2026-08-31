import Image from "next/image";
import Link from "next/link";
import { formatDate, formatNumber } from "@/lib/format";
import type { CatalogSummary } from "@/lib/server/db/catalogs";

export function CatalogListRow({ catalog }: { catalog: CatalogSummary }) {
  const href = `/catalogs/${catalog.id}`;

  return (
    <article className="flex items-start gap-3.5 py-3.5">
      <Link
        aria-label={`查看目录：${catalog.title}`}
        className="group relative block aspect-4/3 w-26 shrink-0 overflow-hidden rounded-md border border-border bg-muted/15 sm:w-32"
        href={href}
      >
        {catalog.coverBlobSha256 ? (
          <Image
            alt=""
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
            height={96}
            src={`/api/media/blobs/${catalog.coverBlobSha256}`}
            unoptimized
            width={128}
          />
        ) : (
          <span className="flex h-full items-center justify-center px-1 text-center font-mono text-[10.5px] text-muted">
            暂无封面
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link
            className="text-[15.5px] font-bold leading-[1.45] hover:text-primary hover:underline hover:underline-offset-3"
            href={href}
          >
            {catalog.title}
          </Link>
          <span className="font-mono text-[11.5px] text-muted">
            {formatNumber(catalog.itemCount)} 个游戏
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-[1.55] text-muted">
          {catalog.description || "未填写说明。"}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          <span>
            创建者{" "}
            <Link
              className="font-semibold text-primary hover:underline hover:underline-offset-2"
              href={`/users/${catalog.ownerUserId}`}
            >
              {catalog.ownerName}
            </Link>
          </span>
          <span>
            创建于 <time className="font-mono" dateTime={catalog.createdAt}>{formatDate(catalog.createdAt)}</time>
          </span>
          <span>
            更新于 <time className="font-mono" dateTime={catalog.updatedAt}>{formatDate(catalog.updatedAt)}</time>
          </span>
        </div>
      </div>
    </article>
  );
}
