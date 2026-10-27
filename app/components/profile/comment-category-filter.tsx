import { COMMENT_TARGET_LABELS, type CommentTarget } from "@/lib/comment-target";
import { Link } from "react-router";

export function CommentCategoryFilter({ basePath, kind }: {
  basePath: string;
  kind?: CommentTarget["kind"];
}) {
  const categories = [["", "全部"], ...Object.entries(COMMENT_TARGET_LABELS)];
  return (
    <nav aria-label="评论类别" className="mb-2 flex max-w-full gap-1 overflow-x-auto border-b border-border">
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
