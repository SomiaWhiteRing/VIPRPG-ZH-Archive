import { WorkListSummary } from "@/app/components/work/work-list-summary";
import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import Link from "next/link";
import type { ReactNode } from "react";
import { engineLabel } from "@/lib/labels";

export type WorkListItemData = {
  workId: number;
  title: string;
  originalTitle: string;
  chineseTitle: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  language: string;
  previewBlobSha256?: string | null;
};

export function WorkListItem({
  index,
  item,
  management,
  note,
}: {
  index: number;
  item: WorkListItemData;
  management?: ReactNode;
  note?: string | null;
}) {
  const href = `/games/${item.workId}`;

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
        <WorkThumbnail blobSha256={item.previewBlobSha256} alt="" width={128} height={96} imageClassName="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" fallbackClassName="flex h-full items-center justify-center px-1 text-center font-mono text-[10px] text-muted" fallback={engineLabel(item.engineFamily)} />
      </Link>
      <WorkListSummary href={href} title={item.title} originalTitle={item.chineseTitle ? item.originalTitle : null} releaseDate={item.originalReleaseDate} engineFamily={item.engineFamily} language={item.language} management={management}>{note ? (
          <p className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/5 px-3 py-2 text-[13px] leading-[1.6]">
            {note}
          </p>
        ) : null}</WorkListSummary>
    </li>
  );
}
