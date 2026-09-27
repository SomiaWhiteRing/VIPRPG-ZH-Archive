import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import { tagNameKey, type UserTagSummary } from "@/lib/user-tags";
import { Link } from "react-router";

export function FavoriteTagSidebar({
  tags,
  selectedTag,
  basePath,
}: {
  tags: readonly UserTagSummary[];
  selectedTag: string;
  basePath: string;
}) {
  const selectedKey = tagNameKey(selectedTag);
  const items = [
    { name: "全部", tag: "", count: undefined },
    ...tags.map(({ name, workCount }) => ({ name, tag: name, count: workCount })),
  ];

  return (
    <aside className="min-w-0 self-start pt-2.5" aria-labelledby="favorite-tags-title">
      <h2 id="favorite-tags-title" className="m-0 border-b border-border py-1.5 text-[15px] font-normal">
        收藏标签
      </h2>
      <nav aria-labelledby="favorite-tags-title">
        <ul className="m-0 list-none p-0">
          {items.map(({ name, tag, count }) => {
            const active = selectedKey === tagNameKey(tag);
            return (
              <li className="border-b border-dashed border-border" key={tagNameKey(tag)}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-8 items-baseline justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm text-primary pointer-coarse:min-h-11",
                    active ? "bg-muted/15" : "hover:bg-muted/10",
                  )}
                  to={tag ? `${basePath}?${new URLSearchParams({ tag })}` : basePath}
                >
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">{name}</span>
                  {count !== undefined ? <small className="shrink-0 text-xs tabular-nums text-muted">{formatNumber(count)}</small> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
