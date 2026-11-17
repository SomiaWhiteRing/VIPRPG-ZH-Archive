import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE, parseUiLocale, UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { requestJson, type ApiResponsePayload } from "@/lib/ui/api-response";

import { AUTO_LINK_PATTERN, autoLink } from "@/lib/auto-links";
import { MentionText } from "@/app/components/comments/mention-text";
import { resolveEmojis } from "@/app/components/emojis/client";
import { FaceEmojiView } from "@/app/components/emojis/face-emoji";
import { emojiIds } from "@/lib/face-emojis";
import { FORUM_ELEMENT_PATTERN, readForumElement } from "@/lib/forum-elements";
import { forumDice, parseForumBBCode, type ForumBBCodeNode } from "@/lib/forum-bbcode";
import { BrowserElement } from "./browser-element";
import { TokenPicker } from "@/app/components/pickers/token-picker";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { TextSize } from "@/app/components/ui/text-size";
import { Dice5 } from "lucide-react";
import * as Dialog from "@/app/components/ui/dialog";
import { Label } from "@/app/components/ui/label";
import type { FaceEmoji } from "@/lib/dto/db/work-community";
import { type ForumAuthor, type ForumEditContent, type ForumTag, type ForumTarget, type ForumTopic, forumHref, forumTagError, normalizeForumTag } from "@/lib/forum";

import { forumSearchMatches } from "@/lib/forum-search";
import { type KeyboardEventHandler, type ReactNode, Fragment, useEffect, useRef, useState } from "react";

import { LocaleLink as Link } from "@/app/components/ui/locale-link";

export async function forumRequest<T>(
  url: string,
  input?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const locale = parseUiLocale(document.documentElement.lang) ?? DEFAULT_UI_LOCALE;
  const target = new URL(url, window.location.origin);
  if (target.origin === window.location.origin && !target.searchParams.has(UI_LOCALE_PARAM)) {
    const current = new URLSearchParams(window.location.search);
    if (locale !== DEFAULT_UI_LOCALE || current.has(UI_LOCALE_PARAM)) {
      target.searchParams.set(UI_LOCALE_PARAM, locale);
    }
  }
  return requestJson<T & ApiResponsePayload>(target.href, {
    method: input ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal,
    ...(input ? { headers: { "content-type": "application/json" }, body: JSON.stringify(input) } : {}),
  }, translate(locale, "forum.loadError"));
}
export function readForumEditContent(target: ForumTarget) {
  return forumRequest<ForumEditContent>(
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
  topic: Pick<ForumTopic, "featured" | "locked" | "pinned" | "saged">;
  compact?: boolean;
}) {
  const t = useMessages();
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
      {topic.saged ? (
        <Badge className={className}>SAGE</Badge>
      ) : topic.pinned ? (
        <Badge className={className}>{t("comment.pinned")}</Badge>
      ) : null}
      {topic.featured ? <Badge className={className}>{t("forum.featuredBadge")}</Badge> : null}
      {topic.locked ? <Badge className={className} variant="neutral">{t("forum.locked")}</Badge> : null}
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
  interactiveElements = true,
  images = [],
  diceKey,
}: {
  body: string;
  emojis: FaceEmoji[];
  inline?: boolean;
  interactiveElements?: boolean;
  images?: { offset: number; content: ReactNode }[];
  diceKey?: string;
}) {
  const t = useMessages();
  const emojiMap = new Map(emojis.map((emoji) => [emoji.id, emoji]));
  function renderText(text: string) {
    return text.split(new RegExp(`(${AUTO_LINK_PATTERN.source}|:face_[1-9]\\d{0,15}:|${FORUM_ELEMENT_PATTERN.source})`, "g")).map((part, index) => {
        const source = !inline ? readForumElement(part) : null;
        if (source !== null) return <BrowserElement key={index} source={source} interactive={interactiveElements} />;
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
    });
  }
  let diceOrdinal = 0;
  function renderNodes(nodes: ForumBBCodeNode[], literal = false): ReactNode {
    return nodes.map((node, index) => {
      if (node.type === "text") return <Fragment key={index}>{literal ? node.text : renderText(node.text)}</Fragment>;
      if (node.type === "image") return <Fragment key={index}>{images[node.index]?.content}</Fragment>;
      if (node.type === "dice") {
        const expression = node.children.map((child) => child.type === "text" ? child.text : "").join("");
        const diceClassName = "inline-flex max-w-full flex-wrap items-center gap-2 border-l-[3px] border-primary bg-primary/5 px-3 py-2 font-mono text-sm";
        if (diceKey === undefined) return <span key={index} className={diceClassName} aria-label={t("forum.history.dicePreview", { expression })} title={t("forum.history.dicePending")}><Dice5 aria-hidden className="size-4 shrink-0" />{renderNodes(node.children, true)}<span aria-hidden="true">→</span><strong className="text-primary">?</strong></span>;
        const dice = node.children.every((child) => child.type === "text")
          ? forumDice(expression, diceKey, diceOrdinal++) : null;
        return dice ? <span key={index} className={diceClassName} title={t("forum.history.diceFixed")}><Dice5 aria-hidden className="size-4 shrink-0" />{dice.notation}<span aria-hidden="true">→</span><strong className="min-w-0 wrap-anywhere text-primary">{dice.calculation}</strong></span>
          : <Fragment key={index}>[dice]{renderNodes(node.children, true)}[/dice]</Fragment>;
      }
      if (node.type === "url") {
        const target = node.parameter ?? node.children.map((child) => child.type === "text" ? child.text : "").join("");
        const link = autoLink(target);
        if (!link || link.suffix) return <Fragment key={index}>[url{node.parameter ? `=${node.parameter}` : ""}]{renderNodes(node.children, true)}[/url]</Fragment>;
        return <a key={index} className="text-primary underline" href={link.href} target="_blank" rel="nofollow ugc noopener noreferrer">{renderNodes(node.children, true)}</a>;
      }
      const children = renderNodes(node.children, literal || node.type === "code");
      switch (node.type) {
        case "b": return <strong key={index}>{children}</strong>;
        case "i": return <em key={index}>{children}</em>;
        case "u": return <u key={index}>{children}</u>;
        case "s":
        case "del": return <s key={index}>{children}</s>;
        case "size": return <TextSize key={index} size={`${Number(node.parameter!.slice(0, -1)) * 0.009375}rem`}>{children}</TextSize>;
        case "quote": return <blockquote key={index} className="my-2 border-l-2 border-primary/40 pl-3 text-muted">{children}</blockquote>;
        case "code": return <code key={index} className="my-2 block rounded-md bg-muted/10 p-3 font-mono text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{children}</code>;
        case "list": return <ul key={index} className="my-2 list-disc pl-6">{renderNodes(node.children.filter((child) => child.type !== "text" || child.text.trim()))}</ul>;
        case "item": return <li key={index} className="whitespace-normal">{children}</li>;
        case "hr": return <hr key={index} className="my-3 border-border" />;
        case "spoiler":
        case "collapse": return <details key={index} className="my-2 rounded-md border border-border px-3 py-2"><summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-primary">{node.parameter || t("forum.bbcode.expandContent")}</summary><div className="pt-2">{children}</div></details>;
      }
    });
  }
  // Nested replies sit inside a sentence; block-format BBCode stays literal there.
  const Wrapper = inline ? "span" : "div";
  return (
    <Wrapper
      className={`${inline ? "" : "block max-w-[120ch]"} whitespace-pre-wrap text-[15px] leading-[1.7] [overflow-wrap:anywhere]`}
    >
      {inline ? renderText(body) : renderNodes(parseForumBBCode(body, images.map((image) => image.offset)))}
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
  const t = useMessages();
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
                aria-label={t("core.action.close")}
                title={t("core.action.close")}
                disabled={busy}
              >
                {t("core.action.close")}
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
  const t = useMessages();
  const locale = useUiLocale();
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
  const [error, setError] = useState(false);
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
        setError(false);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(true);
      });
    return () => controller.abort();
  }, [submitted, cursor, retry]);
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t("forum.tags.label")}</Label>
      <TokenPicker
        label={t("forum.tags.label")}
        id={id}
        values={values}
        onChange={onChange}
        suggestions={tags
          .filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
          .map((t) => ({
            value: t.name,
            meta: "",
          }))}
        placeholder={t("forum.tags.choose")}
        recommendationLabel={t("forum.tags.recommended")}
        recommendations={recommendations.map((value) => ({ value, meta: "" }))}
        disabled={disabled}
        maxValues={5}
        normalizeValue={normalizeForumTag}
        validateValue={(value) => forumTagError(value, locale)}
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
          {t("forum.tags.more")}
        </Button>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="status">
          {t("forum.tags.suggestFailed")}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRetry((n) => n + 1)}
            type="button"
          >
            {t("core.action.retry")}
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
  const t = useMessages();
  return (
    <div
      role="group"
      aria-label={t("forum.popularTags")}
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
