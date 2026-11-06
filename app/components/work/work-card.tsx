import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import { Button } from "@/app/components/ui/button";
import type { MouseEventHandler, ReactNode } from "react";
import { Link } from "react-router";

const imageMetadataClassName = "absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 via-black/45 to-transparent px-2 pb-1.5 pt-6 font-normal text-white min-[641px]:px-3 min-[641px]:pb-2";
const cardClassName = "group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function WorkCard({
  href,
  onOpen,
  disabled,
  label,
  title,
  originalTitle,
  coverBlobSha256,
  coverSrc,
  description,
  imagePriority = false,
  titleAs: Title = "h3",
  metadata,
  imageMetadata,
  imageActions,
  imageBadge,
  action,
  children,
}: {
  label?: string;
  title: string;
  originalTitle?: string | null;
  coverBlobSha256?: string | null;
  coverSrc?: string;
  description?: string;
  imagePriority?: boolean;
  titleAs?: "h2" | "h3";
  metadata?: ReactNode;
  imageMetadata?: ReactNode;
  imageActions?: ReactNode;
  imageBadge?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
} & ({ href: string; onOpen?: never; disabled?: never } | { href?: never; onOpen: MouseEventHandler<HTMLButtonElement>; disabled?: boolean })) {
  const content = <>
        <div className="relative grid aspect-4/3 place-items-center overflow-hidden bg-muted/15 font-mono text-xs font-bold text-muted">
          <WorkThumbnail
            blobSha256={coverBlobSha256}
            src={coverSrc}
            width={420}
            height={315}
            fallback="暂无封面"
            priority={imagePriority}
          />
          {imageMetadata ? (
            <div className={imageMetadataClassName}>
              {imageMetadata}
            </div>
          ) : null}
          {imageBadge && !action ? (
            <span className={imageMetadata || imageActions
              ? "absolute top-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] font-normal text-white"
              : "absolute right-1.5 bottom-1.5 rounded-md bg-foreground/80 dark:bg-black/80 px-1.5 py-0.5 font-mono text-[11px] font-normal text-white max-[640px]:hidden"}>
              {imageBadge}
            </span>
          ) : null}
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-1 wrap-anywhere p-2 min-[641px]:px-3 min-[641px]:pt-2.5 min-[641px]:pb-3">
          <div className="h-[calc(1.45em*2)] overflow-hidden text-[12.5px] font-normal leading-[1.45] min-[641px]:text-[14.5px] min-[641px]:font-semibold">
            <Title className="relative m-0 line-clamp-2 overflow-visible">
              {title}
              {originalTitle && originalTitle !== title ? (
                <span className="absolute inset-x-0 top-full hidden truncate text-xs font-normal text-muted min-[641px]:block">
                  {originalTitle}
                </span>
              ) : null}
            </Title>
          </div>
          {metadata}
          {children}
        </div>
      </>;
  return (
    <div className="relative min-w-0">
      {onOpen ? <Button variant="ghost" type="button" disabled={disabled} onClick={onOpen} aria-label={label} aria-description={description}
        className={`${cardClassName} h-auto min-h-0 w-full items-stretch justify-start gap-0 whitespace-normal p-0 text-left font-normal hover:bg-card`}>{content}</Button>
        : <Link aria-label={label} aria-description={description} className={cardClassName} to={href}>{content}</Link>}
      {imageActions ? <div className="pointer-events-none absolute inset-x-0 top-0 aspect-4/3"><div className={imageMetadataClassName}>{imageActions}</div></div> : null}
      {action ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 aspect-4/3">
          <div className={imageMetadata || imageActions
            ? "pointer-events-auto absolute top-1.5 right-1.5"
            : "pointer-events-auto absolute right-1.5 bottom-1.5"}>{action}</div>
        </div>
      ) : null}
    </div>
  );
}
