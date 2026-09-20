import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import type { ReactNode } from "react";
import { Link } from "react-router";

export function WorkCard({
  href,
  title,
  originalTitle,
  coverBlobSha256,
  ariaLabel = title,
  metadata,
  imageBadge,
  action,
  children,
}: {
  href: string;
  title: string;
  originalTitle?: string | null;
  coverBlobSha256?: string | null;
  ariaLabel?: string;
  metadata?: ReactNode;
  imageBadge?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative min-w-0">
      <Link
        aria-label={ariaLabel}
        className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        to={href}
      >
        <div className="relative grid aspect-4/3 place-items-center overflow-hidden bg-muted/15 font-mono text-xs font-bold text-muted">
          <WorkThumbnail
            blobSha256={coverBlobSha256}
            width={420}
            height={315}
            fallback="暂无封面"
          />
          {imageBadge && !action ? (
            <span className="absolute right-1.5 bottom-1.5 rounded-md bg-foreground/80 px-1.5 py-0.5 font-mono text-[11px] font-normal text-white max-[640px]:hidden">
              {imageBadge}
            </span>
          ) : null}
        </div>
        <div className="grid gap-1 p-2 min-[641px]:px-3 min-[641px]:pt-2.5 min-[641px]:pb-3">
          <h3 className="m-0 line-clamp-2 h-[calc(1.45em*2)] text-[12.5px] font-normal leading-[1.45] min-[641px]:text-[14.5px] min-[641px]:font-semibold">
            {title}
            {originalTitle && originalTitle !== title ? (
              <span className="hidden text-xs font-normal text-muted min-[641px]:block">
                {originalTitle}
              </span>
            ) : null}
          </h3>
          {metadata}
          {children}
        </div>
      </Link>
      {action ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 aspect-4/3">
          <div className="pointer-events-auto absolute right-1.5 bottom-1.5">{action}</div>
        </div>
      ) : null}
    </div>
  );
}
