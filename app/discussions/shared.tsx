import { requestJson, type ApiResponsePayload } from "@/lib/ui/api-response";

import { AUTO_LINK_PATTERN, autoLink } from "@/lib/auto-links";
import { MentionText } from "@/app/components/comments/mention-text";
import { resolveEmojis } from "@/app/components/emojis/client";
import { FaceEmojiView } from "@/app/components/emojis/face-emoji";
import { emojiIds } from "@/lib/face-emojis";
import { FORUM_ELEMENT_PATTERN, readForumElement } from "@/lib/forum-elements";
import { BrowserElement } from "./browser-element";
import { TokenPicker } from "@/app/components/pickers/token-picker";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { Label } from "@/app/components/ui/label";
import type { FaceEmoji } from "@/lib/dto/db/work-community";
import { type ForumAuthor, type ForumEditVersion, type ForumTag, type ForumTarget, type ForumTopic, forumHref, forumTagError, normalizeForumTag } from "@/lib/forum";

import { forumSearchMatches } from "@/lib/forum-search";
import { type KeyboardEventHandler, type ReactNode, Fragment, useEffect, useRef, useState } from "react";

import { Link } from "react-router";

export async function forumRequest<T>(
  url: string,
  input?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return requestJson<T & ApiResponsePayload>(url, {
    method: input ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal,
    ...(input ? { headers: { "content-type": "application/json" }, body: JSON.stringify(input) } : {}),
  }, "请求失败");
}
export function readForumEditVersion(target: ForumTarget) {
  return forumRequest<ForumEditVersion>(
    forumHref("/api/discussions", { op: "edit", ...target }),
  );
}
export async function referencedForumEmojis(
  bodies: (string | null)[],
  signal?: AbortSignal,
) {
  return resolveEmojis(
    [...new Set(bodies.flatMap((body) => emojiIds(body ?? "")))],
    signal,
  );
}

export function ForumAuthorName({
  author,
  query = "",
}: {
  author: ForumAuthor;
  query?: string;
}) {
  return author.profile ? (
    <Link
      prefetch="none"
      className="break-all text-primary hover:underline"
      to={`/users/${author.id}`}
    >
      <Highlight text={author.name} query={query} />
    </Link>
  ) : (
    <span>
      <Highlight text={author.name} query={query} />
    </span>
  );
}
export function DiscussionTagLink({
  tag,
  query = "",
}: {
  tag: ForumTag;
  query?: string;
}) {
  return (
    <Link
      prefetch="none"
      className="wrap-anywhere text-primary hover:bg-primary/5 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
      to={forumHref("/discussions", { tag: tag.id })}
    >
      [<Highlight text={tag.name} query={query} />]
    </Link>
  );
}
export function TopicTags({
  tags,
  query = "",
}: {
  tags: ForumTag[];
  query?: string;
}) {
  return (
    <>
      {tags.map((tag) => (
        <span key={tag.id}>
          <DiscussionTagLink tag={tag} query={query} />{" "}
        </span>
      ))}
    </>
  );
}
export function TopicStatus({
  topic,
  compact = false,
}: {
  topic: Pick<ForumTopic, "featured" | "locked" | "pinned">;
  compact?: boolean;
}) {
  const className = compact
    ? "min-h-0 rounded bg-[#e1ece5] dark:bg-primary/15 px-[5px] py-0 font-normal leading-[18px] text-primary"
    : undefined;
  return (
    <div
      className={
        compact
          ? "inline-flex flex-wrap items-center gap-1.5"
          : "inline-flex flex-wrap gap-2"
      }
    >
      {topic.pinned ? <Badge className={className}>置顶</Badge> : null}
      {topic.featured ? <Badge className={className}>★ 精品</Badge> : null}
      {topic.locked ? <Badge className={className} variant="neutral">已锁定</Badge> : null}
    </div>
  );
}
export function Highlight({ text, query }: { text: string; query: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of forumSearchMatches(text, query)) {
    if (match.end <= cursor) continue;
    const start = Math.max(cursor, match.start);
    parts.push(
      text.slice(cursor, start),
      <mark
        key={`${start}-${match.end}`}
        className="bg-accent/20 text-foreground"
      >
        {text.slice(start, match.end)}
      </mark>,
    );
    cursor = match.end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
export function ForumBody({
  body,
  emojis,
  inline = false,
}: {
  body: string;
  emojis: FaceEmoji[];
  inline?: boolean;
}) {
  const emojiMap = new Map(emojis.map((emoji) => [emoji.id, emoji]));
  const segments = body.split(new RegExp(`(${AUTO_LINK_PATTERN.source}|:face_[1-9]\\d{0,15}:|${FORUM_ELEMENT_PATTERN.source})`, "g"));
  const Wrapper = inline ? "span" : "div";
  return (
    <Wrapper
      className={`${inline ? "" : "block max-w-[120ch]"} whitespace-pre-wrap text-[15px] leading-[1.7] [overflow-wrap:anywhere]`}
    >
      {segments.map((part, index) => {
        const source = !inline ? readForumElement(part) : null;
        if (source !== null) return <BrowserElement key={index} source={source} />;
        if (/^:face_[1-9]\d{0,15}:$/.test(part))
          return (
            <FaceEmojiView
              emoji={emojiMap.get(Number(part.slice(6, -1))) ?? null}
              key={index}
            />
          );
        const link = autoLink(part);
        if (link) return (
          <Fragment key={index}>
            <a className="text-primary underline" href={link.href} target="_blank" rel="nofollow ugc noopener noreferrer">
              {link.text}
            </a>
            {link.suffix}
          </Fragment>
        );
        return <MentionText key={index} text={part} />;
      })}
    </Wrapper>
  );
}
export function ForumModal({
  open,
  onOpenChange,
  title,
  children,
  confirm = false,
  editor = false,
  busy = false,
  onKeyDown,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirm?: boolean;
  editor?: boolean;
  busy?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="bg-black/40" />
        <Dialog.Content
          onKeyDown={onKeyDown}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            returnFocus.current = document.activeElement as HTMLElement;
            if (confirm) {
              event.preventDefault();
              document
                .querySelector<HTMLElement>("[data-forum-cancel]")
                ?.focus({ preventScroll: true });
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
          className={
            editor
              ? "fixed inset-x-0 bottom-0 top-14 z-50 flex flex-col border border-border bg-card p-4 shadow-surface md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[85dvh] md:w-[calc(100%-2rem)] md:max-w-[880px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-md"
              : "fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md border border-border bg-card p-4 shadow-surface"
          }
        >
          <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
            <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button
                type="button"
                variant="ghost"
                aria-label="关闭"
                title="关闭"
                disabled={busy}
              >
                关闭
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ForumTagEditor({
  values,
  onChange,
  disabled,
  id,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  id: string;
}) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSubmitted(query);
      setCursor(null);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [tags, setTags] = useState<ForumTag[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void forumRequest<{
      tags: ForumTag[];
      nextCursor: string | null;
      recommendations?: string[];
    }>(
      forumHref("/api/discussions", {
        op: "tags",
        mode: "suggest",
        q: submitted,
        cursor,
      }),
      undefined,
      controller.signal,
    )
      .then((result) => {
        setTags((old) => (cursor ? [...old, ...result.tags] : result.tags));
        setNextCursor(result.nextCursor);
        if (result.recommendations) setRecommendations(result.recommendations);
        setError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError("TAG 建议加载失败");
      });
    return () => controller.abort();
  }, [submitted, cursor, retry]);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>TAG</Label>
      <TokenPicker
        label="TAG"
        id={id}
        values={values}
        onChange={onChange}
        suggestions={tags
          .filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
          .map((t) => ({
            value: t.name,
            meta: "",
          }))}
        placeholder="选择或创建 TAG"
        recommendationLabel="推荐tag"
        recommendations={recommendations.map((value) => ({ value, meta: "" }))}
        disabled={disabled}
        maxValues={5}
        normalizeValue={normalizeForumTag}
        validateValue={forumTagError}
        onQueryChange={setQuery}
        sortable
        commitOnBlur
        showHelp={false}
        singleLineRecommendations
      />
      {nextCursor ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCursor(nextCursor)}
        >
          加载更多
        </Button>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="status">
          {error}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRetry((n) => n + 1)}
            type="button"
          >
            重试
          </Button>
        </p>
      ) : null}
    </div>
  );
}
export function PopularTagFilter({
  popular,
  selected,
  onChange,
  hrefForTags,
  disabled,
}: {
  popular: ForumTag[];
  selected: ForumTag[];
  onChange: (tags: ForumTag[]) => void;
  hrefForTags: (tags: ForumTag[]) => string;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="常用 TAG"
      className="flex min-w-0 gap-2 overflow-x-auto py-1 lg:grid lg:overflow-visible lg:py-0"
    >
      {popular.map((tag) => {
        const active = selected.some((item) => item.id === tag.id);
        const nextTags = active ? [] : [tag];
        return (
          <Fragment key={tag.id}>
            <Link
              className="hidden text-sm text-primary hover:underline lg:block"
              to={hrefForTags(disabled ? selected : nextTags)}
              aria-current={active ? "true" : undefined}
              aria-disabled={disabled || undefined}
              onClick={(event) => {
                event.preventDefault();
                if (!disabled) onChange(nextTags);
              }}
            >
              {tag.name}
            </Link>
            <Button
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              className="shrink-0 lg:hidden"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(nextTags)}
            >
              {tag.name}
            </Button>
          </Fragment>
        );
      })}
    </div>
  );
}
