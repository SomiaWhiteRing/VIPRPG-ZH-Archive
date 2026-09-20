import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import { engineShortLabel, languageLabel } from "@/lib/labels";
import type { ReactNode } from "react";
import { Link } from "react-router";

export function WorkListRow({
  href,
  title,
  originalTitle,
  coverBlobSha256,
  authorName,
  releaseDate,
  engineFamily,
  language,
  index,
  action,
  children,
}: {
  href: string;
  title: string;
  originalTitle?: string | null;
  coverBlobSha256?: string | null;
  authorName?: string;
  releaseDate?: string | null;
  engineFamily?: string;
  language?: string;
  index?: number;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const metadata = [
    authorName,
    releaseDate,
    engineFamily ? engineShortLabel(engineFamily) : null,
    language ? languageLabel(language) : null,
  ].filter(Boolean);

  return (
    <article className="flex items-start gap-3.5 py-3.5">
      {index !== undefined ? (
        <span className="w-6 shrink-0 pt-1 text-right font-mono text-xs text-muted">
          {String(index + 1).padStart(2, "0")}
        </span>
      ) : null}
      <Link
        aria-label={`查看作品：${title}`}
        className="group relative block aspect-4/3 w-26 shrink-0 overflow-hidden rounded-md border border-border bg-muted/15 sm:w-32"
        to={href}
      >
        <WorkThumbnail
          blobSha256={coverBlobSha256}
          width={128}
          height={96}
          imageClassName="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          fallback="暂无封面"
          fallbackClassName="flex h-full items-center justify-center px-1 text-center font-mono text-[10.5px] text-muted"
        />
      </Link>
      <div className="min-w-0 flex-1 wrap-anywhere">
        <Link
          className="text-[15.5px] font-bold leading-[1.45] hover:text-primary hover:underline hover:underline-offset-3"
          to={href}
        >
          {title}
        </Link>
        {originalTitle && originalTitle !== title ? (
          <p className="mt-0.5 text-[12.5px] text-muted">{originalTitle}</p>
        ) : null}
        {metadata.length ? (
          <p className="mt-1 font-mono text-xs text-muted">
            {metadata.join(" / ")}
          </p>
        ) : null}
        {children}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </article>
  );
}
