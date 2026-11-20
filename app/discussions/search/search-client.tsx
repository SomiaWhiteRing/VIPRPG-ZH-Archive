import { useMessages } from "@/lib/i18n/react";
import { Timestamp } from "@/app/components/ui/timestamp";
import type { PublicSearchPage } from "@/lib/dto/forum/activity";
import { EmptyState } from "@/app/components/ui/empty-state";
import { useIsPostAuthorHidden } from "@/app/components/use-is-post-author-hidden";
import {
  ForumAuthorName,
  Highlight,
} from "@/app/discussions/shared";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";

export function DiscussionSearch({
  query,
  result,
  error,
}: {
  query: string;
  result: PublicSearchPage;
  error?: string;
}) {
  const t = useMessages();
  const isPostAuthorHidden = useIsPostAuthorHidden();
  const visibleHits = result.items.filter(hit => !isPostAuthorHidden(hit.author?.id));
  return (
    <section aria-label={t("forum.search")} className="min-w-0">
      {error ? (
        <p role="alert" className="my-4 text-destructive">
          {error}
        </p>
      ) : !query ? null : !result.items.length ? (
        <EmptyState title={t("forum.searchEmpty", { query })} />
      ) : (
        <>
          <p role="status" className="my-6 text-sm text-muted">
            {t("forum.searchCount", { count: result.total })}
          </p>
          {visibleHits.map((hit) => (
            <article
              key={`${hit.kind}-${hit.id}`}
              className="border-b border-border py-4"
            >
              <Link
                className="mt-1 block wrap-anywhere font-bold text-primary"
                to={hit.href}
              >
                <Highlight text={hit.title} query={query} />
              </Link>
              <p className="my-2 line-clamp-2 break-words text-[15px] [overflow-wrap:anywhere]">
                <Highlight text={hit.snippet} query={query} />
              </p>
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                {hit.author ? (
                  <ForumAuthorName author={hit.author} query={query} />
                ) : null}
                <span>{hit.kind === "comment" ? t("forum.nestedResult") : t("forum.rootResult")}</span>
                <Timestamp value={hit.createdAt} />
              </div>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
