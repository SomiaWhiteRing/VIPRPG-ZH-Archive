import { Gamepad2 } from "lucide-react";
import { Link } from "react-router";
import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import type { TimelineWork } from "@/lib/dto/db/timeline";
import { engineShortLabel } from "@/lib/labels";
import { cn } from "@/lib/ui/cn";

export function TimelineWorkPreview({ work, compact }: { work: TimelineWork; compact: boolean }) {
  const metadata = [work.genre, work.engineFamily !== "other" ? engineShortLabel(work.engineFamily) : null].filter(Boolean).join(" · ");
  return <Link to={`/games/${work.id}`} prefetch="none" className="group mt-2 flex min-w-0 max-w-xl items-center gap-3 rounded-lg border border-border/60 bg-muted/5 p-2 transition-colors hover:border-primary/40 hover:bg-muted/10">
    <span className={cn("relative grid aspect-4/3 shrink-0 place-items-center overflow-hidden rounded bg-muted/10 text-muted", compact ? "w-14" : "w-20 sm:w-24")}>
      <WorkThumbnail blobSha256={work.coverBlobSha256} width={compact ? 56 : 96} height={compact ? 42 : 72} fallback={<Gamepad2 aria-hidden className="size-5" />} />
    </span>
    <span className="min-w-0 flex-1 wrap-anywhere">
      <span className="block line-clamp-2 text-sm font-medium leading-snug text-secondary group-hover:text-primary">{work.title}</span>
      {!compact && work.originalTitle !== work.title && <span className="mt-0.5 block truncate text-xs text-muted">{work.originalTitle}</span>}
      {metadata && <span className="mt-1 block truncate text-xs text-muted">{metadata}</span>}
    </span>
  </Link>;
}
