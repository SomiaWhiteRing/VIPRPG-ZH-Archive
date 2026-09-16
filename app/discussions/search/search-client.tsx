import type { PublicSearchPage } from "@/lib/dto/forum/activity";
import { EmptyState } from "@/app/components/ui/empty-state";
import {
  ForumAuthorName,
  ForumTime,
  Highlight,
} from "@/app/discussions/shared";
import { Link } from "react-router";

export function DiscussionSearch({
  query,
  result,
  error,
}: {
  query: string;
  result: PublicSearchPage;
  error?: string;
}) {
  return (
    <section aria-label="讨论搜索" className="min-w-0">
      {error ? (
        <p role="alert" className="my-4 text-destructive">
          {error}
        </p>
      ) : !query ? (
        <EmptyState title="输入关键词搜索讨论。" />
      ) : !result.items.length ? (
        <EmptyState title={`没有找到包含‘${query}’的讨论。`} />
      ) : (
        <>
          <p role="status" className="my-6 text-sm text-muted">
            {result.total} 个结果
          </p>
          {result.items.map((hit) => (
            <article
              key={`${hit.kind}-${hit.id}`}
              className="border-b border-border py-4"
            >
              <Link
                className="mt-1 block break-words font-bold text-primary"
                to={hit.href}
              >
                <Highlight text={hit.title} query={query} />
              </Link>
              <p className="my-2 line-clamp-2 break-words text-sm [overflow-wrap:anywhere]">
                <Highlight text={hit.snippet} query={query} />
              </p>
              <div className="text-xs text-muted">
                {hit.author ? (
                  <ForumAuthorName author={hit.author} query={query} />
                ) : null}{" "}
                · {hit.kind === "comment" ? "楼中楼回复" : "主楼"} ·{" "}
                <ForumTime value={hit.createdAt} />
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
