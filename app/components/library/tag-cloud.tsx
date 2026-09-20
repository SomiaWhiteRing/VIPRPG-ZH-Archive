import type { PublicTagSummary } from "@/lib/dto/db/taxonomy-library";
import { formatNumber } from "@/lib/format";
import { Link } from "react-router";

export function TagCloud({
  tags,
  label = "标签列表",
}: {
  tags: Pick<PublicTagSummary, "id" | "name" | "workCount">[];
  label?: string;
}) {
  return (
    <section aria-label={label}>
      <ul className="m-0 flex list-none flex-wrap items-baseline gap-x-4 gap-y-2 p-0 text-base leading-relaxed">
        {tags.map((tag) => (
          <li className="min-w-0 max-w-full" key={tag.id}>
            <Link
              className="break-words text-primary hover:text-accent hover:underline"
              to={`/games?tag=${tag.id}`}
            >
              {tag.name}
            </Link>
            <small className="ml-1 whitespace-nowrap text-xs text-muted">
              ({formatNumber(tag.workCount)})
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
