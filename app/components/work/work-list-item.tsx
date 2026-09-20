import { WorkListRow } from "@/app/components/work/work-list-row";
import type { ReactNode } from "react";

export type WorkListItemData = {
  workId: number;
  title: string;
  originalTitle: string;
  chineseTitle: string | null;
  originalReleaseDate: string | null;
  engineFamily: string;
  language: string;
  coverBlobSha256?: string | null;
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
    <li>
      <WorkListRow
        href={href}
        title={item.title}
        index={index}
        coverBlobSha256={item.coverBlobSha256}
        originalTitle={item.chineseTitle ? item.originalTitle : null}
        releaseDate={item.originalReleaseDate}
        engineFamily={item.engineFamily}
        language={item.language}
        action={management}
      >
        {note ? (
          <p className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/5 px-3 py-2 text-[13px] leading-[1.6]">
            {note}
          </p>
        ) : null}
      </WorkListRow>
    </li>
  );
}
