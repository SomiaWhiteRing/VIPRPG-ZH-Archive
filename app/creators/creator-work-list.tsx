import { Badge } from "@/app/components/ui/badge";
import { WorkListRow } from "@/app/components/work/work-list-row";
import { useVisibleWorkItems } from "@/app/components/work/use-visible-work-items";
import type { CreatorWorkCredit } from "@/lib/dto/db/creator-library";
import { useUiLocale } from "@/lib/i18n/react";
import { creatorRoleLabel } from "@/lib/labels";

export function CreatorWorkList({ works, creatorName, standalone = false }: {
  works: (CreatorWorkCredit & { credits: CreatorWorkCredit[] })[];
  creatorName: string;
  standalone?: boolean;
}) {
  const locale = useUiLocale();
  const visibleWorks = useVisibleWorkItems(works);
  return (
    <ul className={`m-0 divide-y divide-border border-border p-0 ${standalone ? "border-b" : "border-t"}`}>
      {visibleWorks.map((work) => (
        <li key={work.workId}>
          <WorkListRow
            href={`/games/${work.workId}`}
            title={work.workTitle}
            originalTitle={work.workOriginalTitle}
            coverBlobSha256={work.coverBlobSha256}
            authorName={work.authorName}
            releaseDate={work.originalReleaseDate}
            engineFamily={work.engineFamily}
            language={work.language}
          >
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              {work.credits.map((credit) => (
                <span
                  className="inline-flex max-w-full items-center gap-2"
                  key={`${credit.roleKey}-${credit.displayName}`}
                >
                  <Badge className="shrink-0" variant="credit">
                    {credit.roleLabel || creatorRoleLabel(credit.roleKey, locale)}
                  </Badge>
                  {credit.displayName !== creatorName ? (
                    <span className="min-w-0 text-muted">{credit.displayName}</span>
                  ) : null}
                </span>
              ))}
            </div>
          </WorkListRow>
        </li>
      ))}
    </ul>
  );
}

