import { COMMENT_TARGET_LABELS, type CommentTarget } from "@/lib/comment-target";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages } from "@/lib/i18n/react";

const labels = {
  work: "publicProfile.work",
  creator: "publicProfile.creator",
  character: "publicProfile.character",
  catalog: "timeline.feed.kind.catalog",
} as const;

export function CommentCategoryFilter({ basePath, kind }: {
  basePath: string;
  kind?: CommentTarget["kind"];
}) {
  const t = useMessages();
  const kinds = Object.keys(COMMENT_TARGET_LABELS) as CommentTarget["kind"][];
  const categories = [["", t("timeline.feed.allKinds")], ...kinds.map(value => [value, t(labels[value])])];
  return (
    <nav aria-label={t("publicProfile.commentFilter")} className="mb-2 flex max-w-full gap-1 overflow-x-auto border-b border-border">
      {categories.map(([value, label]) => (
        <Link
          key={value}
          to={value ? `${basePath}?kind=${value}` : basePath}
          preventScrollReset
          aria-current={(kind ?? "") === value ? "page" : undefined}
          className={`inline-flex min-h-10 shrink-0 items-center border-b-2 px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary ${(kind ?? "") === value ? "border-primary bg-primary/5 text-foreground" : "border-transparent text-muted hover:bg-primary/5"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
