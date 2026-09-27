import { formatDate } from "@/lib/format";
import { Link } from "react-router";

export function FavoriteEntryDetails({ occurredAt, tags, basePath }: {
  occurredAt: string;
  tags: readonly string[];
  basePath: string;
}) {
  return (
    <div className="mt-1 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
        <span>{formatDate(occurredAt)}</span>
        {tags.length ? (
          <span className="inline-flex min-w-0 flex-wrap gap-x-1 gap-y-1">
            <span>标签：</span>
            {tags.map((tag) => (
              <Link className="wrap-anywhere hover:text-primary hover:underline" key={tag} to={`${basePath}?${new URLSearchParams({ tag })}`}>
                {tag}
              </Link>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}
