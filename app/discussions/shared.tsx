import { TokenPicker } from "@/app/components/pickers/token-picker";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { Label } from "@/app/components/ui/label";
import type { CustomEmojiDto } from "@/lib/dto/db/work-community";
import type {
  ForumAuthor,
  ForumEditVersion,
  ForumTag,
  ForumTarget,
  ForumTopic,
} from "@/lib/forum";
import {
  FORUM_TAG_LIMIT,
  forumHref,
  forumTagError,
  normalizeForumTag,
} from "@/lib/forum";
import { forumSearchMatches } from "@/lib/forum-search";
import type { KeyboardEventHandler, ReactNode } from "react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

export class ForumRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export async function forumRequest<T>(
  url: string,
  input?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: input ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      ...(input
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
          }
        : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ForumRequestError("网络连接失败，请重试。", 0);
  }
  const data = (await response.json()) as {
    ok?: boolean;
    detail?: string;
    error?: string;
    code?: string;
  };
  if (!response.ok || data.ok === false)
    throw new ForumRequestError(
      data.detail ?? data.error ?? "请求失败，请重试。",
      response.status,
      data.code,
    );
  return data as T;
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
  const codes = [
    ...new Set(
      bodies.flatMap((body) =>
        [...(body ?? "").matchAll(/:([A-Za-z0-9_+-]{1,64}):/g)].map(
          (m) => m[1],
        ),
      ),
    ),
  ];
  const emojis: CustomEmojiDto[] = [];
  for (let start = 0; start < codes.length; start += 100) {
    const data = await forumRequest<{ emojis: CustomEmojiDto[] }>(
      forumHref("/api/discussions", {
        op: "emojis",
        shortcode: codes.slice(start, start + 100),
      }),
      undefined,
      signal,
    );
    emojis.push(...data.emojis);
  }
  return emojis;
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
      className="break-words text-primary hover:bg-primary/5 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
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
}: {
  topic: Pick<ForumTopic, "featured" | "locked">;
}) {
  return (
    <div className="inline-flex flex-wrap gap-2">
      {topic.featured ? <Badge>★ 精品</Badge> : null}
      {topic.locked ? <Badge variant="secondary">已锁定</Badge> : null}
    </div>
  );
}
const forumDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Hong_Kong",
});
export function ForumTime({
  value,
  relative = false,
}: {
  value: string;
  relative?: boolean;
}) {
  const date = new Date(
    value.includes("T") ? value : value.replace(" ", "T") + "Z",
  );
  const full = forumDateFormatter.format(date);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(timer);
  }, []);
  let label = full;
  if (relative && now) {
    const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60000));
    label =
      minutes < 1
        ? "刚刚"
        : minutes < 60
          ? `${minutes}分钟前`
          : minutes < 1440
            ? `${Math.floor(minutes / 60)}小时前`
            : `${Math.floor(minutes / 1440)}天前`;
  }
  return (
    <time
      className="font-mono text-xs tabular-nums"
      dateTime={date.toISOString()}
      title={full}
    >
      {label}
    </time>
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
const emojiMaps = new WeakMap<CustomEmojiDto[], Map<string, CustomEmojiDto>>();
export function ForumBody({
  body,
  emojis,
  inline = false,
}: {
  body: string;
  emojis: CustomEmojiDto[];
  inline?: boolean;
}) {
  let emojiMap = emojiMaps.get(emojis);
  if (!emojiMap) {
    emojiMap = new Map(emojis.map((e) => [`:${e.shortcode}:`, e]));
    emojiMaps.set(emojis, emojiMap);
  }
  const segments = body.split(/(https?:\/\/[^\s<>]+|:[A-Za-z0-9_+-]{1,64}:)/g);
  return (
    <span
      className={`${inline ? "text-sm" : "block max-w-[76ch] text-base"} whitespace-pre-wrap break-words leading-[1.7] [overflow-wrap:anywhere]`}
    >
      {segments.map((part, index) => {
        const emoji = part.startsWith(":") ? emojiMap.get(part) : null;
        if (emoji)
          return (
            <img
              alt={`:${emoji.shortcode}:`}
              className="mx-0.5 inline-block size-6 align-text-bottom"
              height={24}
              width={24}
              src={emoji.imageUrl}
              key={index}
              loading="lazy"
            />
          );
        if (/^https?:\/\//.test(part)) {
          try {
            const url = new URL(part);
            if (url.protocol === "http:" || url.protocol === "https:")
              return (
                <a
                  className="text-primary underline"
                  key={index}
                  href={url.href}
                  target="_blank"
                  rel="nofollow ugc noopener noreferrer"
                >
                  {part}
                </a>
              );
          } catch {
            /* 无效地址按纯文本显示。 */
          }
        }
        return <span key={index}>{part}</span>;
      })}
    </span>
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
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void forumRequest<{ tags: ForumTag[]; nextCursor: string | null }>(
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
        disabled={disabled}
        maxValues={5}
        normalizeValue={normalizeForumTag}
        validateValue={forumTagError}
        onQueryChange={setQuery}
        sortable
        showRecommendations={false}
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
        const nextTags = active
          ? selected.filter((item) => item.id !== tag.id)
          : [...selected, tag];
        const unavailable =
          disabled || (!active && selected.length >= FORUM_TAG_LIMIT);
        return (
          <Fragment key={tag.id}>
            <Link
              className="hidden text-sm text-primary hover:underline lg:block"
              to={hrefForTags(unavailable ? selected : nextTags)}
              aria-current={active ? "true" : undefined}
              aria-disabled={unavailable || undefined}
              onClick={(event) => {
                event.preventDefault();
                if (!unavailable) onChange(nextTags);
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
              disabled={unavailable}
              onClick={() => onChange(nextTags)}
            >
              {active ? <span aria-hidden="true">✓</span> : null}
              {tag.name}
            </Button>
          </Fragment>
        );
      })}
    </div>
  );
}
