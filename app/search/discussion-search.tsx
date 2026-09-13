"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Checkbox } from "@/app/components/ui/checkbox";
import { SelectField } from "@/app/components/ui/select";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { EmptyState } from "@/app/components/ui/empty-state";
import {
  forumHref,
  forumTargetHref,
  type ForumPage,
  type ForumSearchHit,
  type ForumTag,
} from "@/lib/forum";
import {
  ForumAuthorName,
  ForumTime,
  Highlight,
  ForumModal,
  TagFilter,
  TopicStatus,
  TopicTags,
} from "@/app/discussions/shared";
export function DiscussionSearch({
  query,
  tags,
  featured,
  latest,
  result,
  error,
}: {
  query: string;
  tags: ForumTag[];
  featured: boolean;
  latest: boolean;
  result: ForumPage<ForumSearchHit>;
  error?: string;
}) {
  const router = useRouter(),
    [pending, start] = useTransition(),
    [text, setText] = useState(query),
    [onlyFeatured, setFeatured] = useState(featured),
    [sort, setSort] = useState(latest ? "latest" : "relevance"),
    [filtersOpen, setFiltersOpen] = useState(false),
    [draftTags, setDraftTags] = useState(tags),
    [draftFeatured, setDraftFeatured] = useState(featured),
    [draftSort, setDraftSort] = useState(latest ? "latest" : "relevance");
  function apply(
    nextTags = tags,
    nextFeatured = onlyFeatured,
    nextSort = sort,
    nextQuery = text,
  ) {
    start(() =>
      router.push(
        forumHref("/search", {
          scope: "discussions",
          q: nextQuery.trim(),
          tag: nextTags.map((t) => t.id).sort((a, b) => a - b),
          featured: nextFeatured ? 1 : null,
          sort: nextSort === "latest" ? "latest" : null,
        }),
      ),
    );
  }
  return (
    <section aria-label="讨论搜索" aria-busy={pending} className="py-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <Label className="sr-only" htmlFor="forum-search-query">
          搜索讨论
        </Label>
        <Input
          type="search"
          id="forum-search-query"
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" disabled={pending}>
          搜索
        </Button>
      </form>
      <div className="my-4 hidden flex-wrap items-center gap-3 md:flex">
        <TagFilter
          selected={tags}
          onApply={(next) => apply(next)}
          disabled={pending}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="forum-featured-only"
            checked={onlyFeatured}
            onCheckedChange={(value) => {
              setFeatured(!!value);
              apply(tags, !!value);
            }}
            disabled={pending}
          />
          <Label htmlFor="forum-featured-only">仅精品</Label>
        </div>
        <SelectField
          aria-label="排序"
          value={sort}
          disabled={pending}
          onValueChange={(value) => {
            setSort(value);
            apply(tags, onlyFeatured, value);
          }}
          options={[
            { value: "relevance", label: "相关性" },
            { value: "latest", label: "最新发布" },
          ]}
        />
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => apply([], false, "relevance", query)}
        >
          重置
        </Button>
      </div>
      <Button
        className="my-3 md:hidden"
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          setDraftTags(tags);
          setDraftFeatured(featured);
          setDraftSort(latest ? "latest" : "relevance");
          setFiltersOpen(true);
        }}
      >
        筛选
      </Button>
      <ForumModal
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="筛选讨论"
      >
        <div className="grid gap-4">
          <TagFilter selected={draftTags} onApply={setDraftTags} />
          <div className="flex flex-wrap gap-2">
            {draftTags.map((tag) => (
              <Button
                key={tag.id}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDraftTags((items) =>
                    items.filter((item) => item.id !== tag.id),
                  )
                }
              >
                [{tag.name}] ×
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="mobile-forum-featured"
              checked={draftFeatured}
              onCheckedChange={(value) => setDraftFeatured(!!value)}
            />
            <Label htmlFor="mobile-forum-featured">仅精品</Label>
          </div>
          <div>
            <Label htmlFor="mobile-forum-sort">排序</Label>
            <SelectField
              id="mobile-forum-sort"
              value={draftSort}
              onValueChange={setDraftSort}
              options={[
                { value: "relevance", label: "相关性" },
                { value: "latest", label: "最新发布" },
              ]}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFiltersOpen(false);
                apply([], false, "relevance", query);
              }}
            >
              重置
            </Button>
            <Button
              type="button"
              onClick={() => {
                setFiltersOpen(false);
                apply(draftTags, draftFeatured, draftSort, query);
              }}
            >
              应用筛选
            </Button>
          </div>
        </div>
      </ForumModal>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            key={tag.id}
            disabled={pending}
            onClick={() => apply(tags.filter((t) => t.id !== tag.id))}
          >
            [{tag.name}] ×
          </Button>
        ))}
        {featured ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => apply(tags, false)}
          >
            仅精品 ×
          </Button>
        ) : null}
        <span className="text-sm text-muted">
          {latest ? "最新发布" : "相关性"}
        </span>
      </div>
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
          <p role="status" className="my-4 text-sm text-muted">
            {pending ? "正在搜索…" : `${result.total} 个结果`}
          </p>
          {result.items.map((hit) => (
            <article
              key={`${hit.content.kind}-${hit.content.id}`}
              className="border-b border-border py-4"
            >
              <div className="text-sm">
                <TopicTags tags={hit.topic.tags} query={query} />
                <TopicStatus topic={hit.topic} />
              </div>
              <a
                className="mt-1 block break-words font-bold text-primary"
                href={forumTargetHref(
                  { kind: hit.content.kind, id: hit.content.id },
                  hit.topic.id,
                  hit.content.postNumber,
                )}
              >
                <Highlight text={hit.topic.title} query={query} />
              </a>
              <p className="my-2 line-clamp-2 break-words text-sm [overflow-wrap:anywhere]">
                <Highlight text={hit.snippet} query={query} />
              </p>
              <div className="text-xs text-muted">
                {hit.content.author ? (
                  <ForumAuthorName author={hit.content.author} query={query} />
                ) : null}{" "}
                · #{hit.content.postNumber}
                {hit.content.kind === "comment" ? " 的楼中楼" : ""} ·{" "}
                <ForumTime value={hit.content.createdAt} /> · 主题共{" "}
                {hit.topic.replies} 条回复
              </div>
            </article>
          ))}
        </>
      )}
      <PaginationLinks
        basePath="/search"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        params={{
          scope: "discussions",
          q: query,
          tag: tags.map((t) => String(t.id)),
          featured: featured ? "1" : undefined,
          sort: latest ? "latest" : undefined,
        }}
      />
    </section>
  );
}
