import { formatNumber } from "@/lib/format";
import { Link } from "react-router";
import { tagHref, type CombinedTagSummary } from "@/lib/user-tags";

export function TagCloud({
  tags,
  label = "标签列表",
}: {
  tags: CombinedTagSummary[];
  label?: string;
}) {
  return (
    <section aria-label={label}>
      <ul className="m-0 flex list-none flex-wrap items-baseline gap-x-4 gap-y-2 p-0 text-base leading-relaxed">
        {tags.map((tag) => (
          <li className="min-w-0 max-w-full" key={tag.name}>
            <Link
              className="break-words text-primary hover:underline"
              to={tagHref(tag.name)}
            >
              {tag.name}
            </Link>
            <small className="ml-1 whitespace-nowrap text-xs text-muted">
              ({formatNumber(tag.usageCount)})
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
