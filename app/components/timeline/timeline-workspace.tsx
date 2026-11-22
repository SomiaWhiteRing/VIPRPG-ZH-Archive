import { RichMessage } from "@/app/components/ui/rich-message";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { preserveUiLocale, UI_LOCALE_PARAM, withoutUiLocale, type UiLocale } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useNavigation, useRevalidator, useRouteLoaderData } from "react-router";
import { ChevronDown, Globe, RefreshCw, Settings, Trash2, Users } from "lucide-react";
import type { loader as rootLoader } from "@/app/root";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Label } from "@/app/components/ui/label";
import { Notice } from "@/app/components/ui/notice";
import { StatusBody, StatusEditor, type StatusEditorHandle } from "./status-editor";
import { CommentImages } from "@/app/components/comments/images";
import { StatusInteractions } from "./status-interactions";
import { TimelineWorkPreview } from "./work-preview";
import { InboxReadOnView } from "@/app/inbox/read-on-view";
import { useTimelineDraft } from "./draft-cache";
import { bodyLength } from "@/lib/face-emojis";
import { formatDate, formatDateKey, parseTimestamp } from "@/lib/format";
import { Timestamp } from "@/app/components/ui/timestamp";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { useIsPostAuthorHidden } from "@/app/components/use-is-post-author-hidden";
import { useToast } from "@/app/components/ui/toast";
import { TIMELINE_FILTER_KINDS, type TimelineItem, type TimelineKind, type TimelinePage, type TimelineReplyPage, type TimelineSettings, type TimelineView } from "@/lib/dto/db/timeline";
import { cn } from "@/lib/ui/cn";

type Props = {
  page: TimelinePage;
  viewerId: number | null;
  settings: TimelineSettings | null;
  basePath: string;
  kind?: TimelineKind;
  view?: TimelineView;
  profile?: boolean;
  showAuthor?: boolean;
  readOnlyInteractions?: boolean;
  expandReplies?: boolean;
  canCompose?: boolean;
  canPublish?: boolean;
  hasCursor?: boolean;
  focused?: boolean;
  initialReplies?: TimelineReplyPage;
  targetReplyId?: number | null;
  inboxItemId?: number;
};

function timelineHref(basePath: string, view: TimelineView, kind?: TimelineKind, cursor?: string | null) {
  const query = new URLSearchParams();
  if (basePath === "/timeline" || basePath === "/" || view !== "all") query.set("view", view);
  if (kind) query.set("kind", kind);
  if (cursor) query.set("cursor", cursor);
  return basePath + (query.size ? `?${query}` : "");
}

function groupTimelineDays(items: TimelineItem[], serverTime: number | undefined, locale: UiLocale) {
  const today = serverTime === undefined ? null : formatDateKey(new Date(serverTime));
  const yesterday = serverTime === undefined ? null : formatDateKey(new Date(serverTime - 86400000));
  const groups: { date: string; label: string; entries: { item: TimelineItem; olderRenames?: TimelineItem[] }[] }[] = [];
  for (const item of items) {
    const date = formatDateKey(parseTimestamp(item.createdAt));
    const group = groups.at(-1);
    if (group?.date !== date) {
      groups.push({ date, label: date === today ? translate(locale, "timeline.feed.today") : date === yesterday ? translate(locale, "timeline.feed.yesterday") : formatDate(item.createdAt, { time: false, locale }), entries: [{ item }] });
      continue;
    }
    const previous = group.entries.at(-1);
    if (item.kind === "rename" && previous?.item.kind === "rename") (previous.olderRenames ??= []).push(item);
    else group.entries.push({ item });
  }
  return groups;
}

function AccountHistoryEntry({ item, showAuthor, timeAction }: { item: TimelineItem; showAuthor: boolean; timeAction?: ReactNode }) {
  const t = useMessages();
  return <article className="flex min-w-0 gap-2.5 sm:gap-3">
    {showAuthor && item.kind === "rename" && <Link className="shrink-0 self-start" to={`/users/${item.actor.id}`} aria-label={t("timeline.feed.profile", { name: item.actor.displayName })}><UserAvatar avatarBlobSha256={item.actor.avatarBlobSha256} displayName={item.actor.displayName} className="size-9" size={36} /></Link>}
    <div className="grid min-w-0 flex-1 gap-2">
      <p className="m-0 text-sm leading-relaxed wrap-anywhere">
        {item.kind === "join"
          ? <>{item.joinName && <><strong>{item.joinName}</strong>{" "}</>}{t(item.joinName ? "timeline.feed.joined" : "timeline.feed.joinedWithoutName")}</>
          : <RichMessage id="timeline.feed.rename" values={{ before: item.nameChange!.previousName, after: item.nameChange!.newName }} components={{ oldName: children => <strong key="before">{children}</strong>, newName: children => <strong key="after">{children}</strong> }} />}
      </p>
      <div className="flex flex-wrap items-center gap-x-2">
        <Timestamp value={item.createdAt} format="duration" className="text-xs text-muted" />
        {timeAction}
      </div>
    </div>
  </article>;
}

function AccountHistoryGroup({ item, olderRenames, showAuthor }: { item: TimelineItem; olderRenames: TimelineItem[]; showAuthor: boolean }) {
  const t = useMessages();
  const [expanded, setExpanded] = useState(false);
  const historyId = useId();
  return <>
    <AccountHistoryEntry item={item} showAuthor={showAuthor} timeAction={
      <Button type="button" variant="ghost" size="sm" className="min-h-8 gap-1 px-1 text-xs font-normal text-secondary"
        aria-expanded={expanded} aria-controls={historyId} onClick={() => setExpanded(!expanded)}>
        {t("timeline.feed.moreRenames", { count: olderRenames.length })}<ChevronDown aria-hidden className={expanded ? "rotate-180" : undefined} />
      </Button>
    } />
    <ol id={historyId} hidden={!expanded} className="m-0 mt-2 list-none space-y-3 p-0">
      {olderRenames.map((rename) => <li key={rename.id}><AccountHistoryEntry item={rename} showAuthor={showAuthor} /></li>)}
    </ol>
  </>;
}

async function mutateTimeline(path: string, locale: UiLocale, method: string, body?: unknown) {

  const url = new URL(path, window.location.origin);
  url.searchParams.set(UI_LOCALE_PARAM, locale);
  await requestJson(url.href, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, translate(locale, "timeline.action.failed"));
}

export function TimelineWorkspace(props: Props) {
  const location = useLocation();
  return <TimelineWorkspaceContent key={`${props.viewerId}:${location.pathname}?${withoutUiLocale(location.search)}`} {...props} />;
}

function TimelineWorkspaceContent({ page, viewerId, settings, basePath, kind, view = "all", profile = false, showAuthor = true, readOnlyInteractions = false, expandReplies = true, canCompose = false, canPublish = false, hasCursor = false, focused = false, initialReplies, targetReplyId = null, inboxItemId }: Props) {
  const t = useMessages();
  const locale = useUiLocale();
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const isPostAuthorHidden = useIsPostAuthorHidden();
  const visibleItems = page.items.filter(item => {
    if (!isPostAuthorHidden(item.actor.id)) return true;
    if (item.kind === "status") return expandReplies && item.replyCount > 0;
    return item.kind !== "comment" && item.kind !== "discussion" && !item.text;
  });
  const mine = view === "mine";
  const [replyBusy, setReplyBusy] = useState<Record<number, boolean>>({});
  const composing = useRef(false);
  const [submittingBusy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const busy = submittingBusy || imageBusy;
  const statusEditor = useRef<StatusEditorHandle>(null);
  const [validation, setValidation] = useState("");
  const [recovery, setRecovery] = useState(false);
  const submitting = useRef(false);
  const confirm = useConfirm();
  const toast = useToast();
  const cacheErrorShown = useRef(false);
  const reportCacheError = useCallback(() => {
    if (cacheErrorShown.current) return;
    cacheErrorShown.current = true;
    toast.error(t("timeline.action.draftError"));
  }, [t, toast]);
  const draft = useTimelineDraft({ userId: canCompose && !profile ? viewerId : null, kind: "status", onError: reportCacheError });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const navigation = useNavigation();
  const navigationState = useRef(navigation.state);
  navigationState.current = navigation.state;
  const navigate = useNavigate();
  function navigateFeed(path: string) {
    const source = new URL(window.location.href);
    const target = preserveUiLocale(new URL(path, source), source);
    return navigate(target.pathname + target.search);
  }
  const revalidator = useRevalidator();
  const anyReplyBusy = Object.values(replyBusy).some(Boolean);
  const allowCreate = !profile && canCompose && canPublish && settings?.enabled;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || composing.current || imageBusy || !draft.ready) return;
    const body = draft.body.trim();
    if (!body || bodyLength(body) > 500) {
      setValidation(t("timeline.action.postLength"));
      return;
    }
    submitting.current = true;
    setBusy(true);
    setValidation("");
    setRecovery(false);
    try {
      const imageIds = await statusEditor.current!.uploadImages();
      await mutateTimeline("/api/timeline", locale, "POST", { body, imageIds, requestKey: draft.requestKey });
      await draft.clear();
      toast.success(t("timeline.action.posted"));
      // Leaving is unrestricted; a finished request must not return to an old feed.
      if (!mounted.current || navigationState.current !== "idle") return;
      if (kind || hasCursor) await navigateFeed(timelineHref(basePath, view));
      else await revalidator.revalidate();
    } catch (error) {
      setRecovery(true);
      toast.error(error instanceof ApiResponseError ? error.messageFor(locale) : error instanceof Error ? error.message : t("timeline.action.postFailed"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function remove(item: TimelineItem) {
    if (busy) return;
    await confirm(t("timeline.action.removeConfirm"), {
      title: t("timeline.action.removeTitle"),
      confirmLabel: t("timeline.action.delete"),
      destructive: true,
      action: async () => {
        await mutateTimeline(`/api/timeline/${item.id}`, locale, "DELETE");
        toast.success(item.kind === "status" ? t("timeline.action.postDeleted") : t("timeline.action.eventRemoved"));
        await revalidator.revalidate();
      },
    });
  }

  function rangeToggle(icon: boolean) {
    const following = view === "following";
    const label = following ? t("timeline.feed.followingHint") : t("timeline.feed.allHint");
    return <Button variant={following ? "default" : "outline"} size={icon ? "icon" : "sm"} className={cn("h-8 min-h-8 shrink-0 rounded-full", icon ? "size-8" : "px-2 text-xs font-medium")} type="button" aria-label={label} title={label} aria-pressed={following} disabled={busy || anyReplyBusy} onClick={() => void navigateFeed(timelineHref(basePath, following ? "all" : "following", kind))}>
      {icon ? following ? <Users aria-hidden /> : <Globe aria-hidden /> : following ? t("timeline.feed.following") : t("timeline.feed.all")}
    </Button>;
  }

  function editor() {
    const { body: value, setBody: onChange, ready } = draft;
    const id = "timeline-status";
    return (
      <form onSubmit={(event) => void submit(event)} aria-busy={busy} className="grid gap-2">
        <Label htmlFor={id} className="sr-only">{t("timeline.action.postPrompt")}</Label>
        <StatusEditor ref={statusEditor} id={id} label={t("timeline.action.postLabel")} body={value} images={draft.images} onImagesChange={draft.setImages} onImagesBusyChange={setImageBusy} busy={busy || !ready} onChange={(body) => { onChange(body); setValidation(""); }} onError={setValidation} onCompositionChange={(value) => { composing.current = value; }} beforeCounter={viewerId && !profile ? <span className="sm:hidden">{rangeToggle(true)}</span> : undefined} actions={<>
          <Button type="submit" size="sm" disabled={busy || imageBusy || !ready || !value.trim()}>{busy ? t("admin.discussionTags.saving") : t("timeline.action.postSubmit")}</Button>
        </>} />
        {validation && <Notice>{validation}</Notice>}
        {recovery && <p role="status" className="m-0 text-sm text-muted">{t("timeline.feed.recovery")}<Link className="text-primary underline" to={`/login?next=${encodeURIComponent(basePath)}`} target="_blank" rel="noopener noreferrer">{t("timeline.feed.signIn")}</Link>{t("timeline.feed.recoveryEnd")}</p>}
      </form>
    );
  }

  return (
    <div className="grid w-full min-w-0 gap-3">
      {!readOnlyInteractions && !focused && <div className="rounded-xl border border-border bg-card">
        {canCompose && !settings?.enabled && <p className="m-0 px-3 py-3 text-sm text-muted sm:px-4">{t("timeline.feed.disabled")}<Link className="ml-1 text-secondary hover:underline" to="/me/timeline">{t("timeline.feed.enable")}</Link>{t("timeline.feed.enableEnd")}</p>}
        {canCompose && settings?.enabled && !canPublish && <p className="m-0 px-3 py-3 text-sm text-muted sm:px-4">{t("timeline.feed.denied")}</p>}
        {allowCreate && <section aria-label={t("timeline.action.postSubmit")} className="p-3 sm:p-4">{editor()}</section>}
        <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-x-2 px-2 py-2 sm:px-3", viewerId && !profile && "sm:grid-cols-[auto_minmax(0,1fr)_auto]", canCompose && "border-t border-border")}>
          {!!viewerId && !profile && <nav aria-label={t("timeline.feed.range")} className="hidden min-w-0 items-center sm:flex">
            {rangeToggle(false)}
          </nav>}
          <nav aria-label={t("timeline.feed.kind")} className="flex min-w-0 items-center gap-0.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {!!viewerId && !profile && !allowCreate && <span className="mr-1 shrink-0 sm:hidden">{rangeToggle(true)}</span>}
            {[undefined, ...TIMELINE_FILTER_KINDS].map((value) => <Link key={value ?? "all"} to={timelineHref(basePath, view, value)} aria-current={kind === value ? "page" : undefined} className={cn("inline-flex h-8 shrink-0 items-center rounded-full px-2 text-xs transition-colors hover:bg-muted/10", kind === value ? "bg-primary/10 font-medium text-secondary" : "text-muted")}>{t(value ? `timeline.feed.kind.${value}` : "timeline.feed.allKinds")}</Link>)}
          </nav>
          {!!viewerId && !profile && <div className="hidden shrink-0 items-center justify-end gap-1 sm:flex">
            <Button asChild variant="ghost" size="icon" className="size-8 text-muted"><Link to="/me/timeline" aria-label={t("timeline.feed.settings")}><Settings aria-hidden /></Link></Button>
            <Button variant="ghost" size="icon" className="size-8 text-muted" type="button" aria-label={t("timeline.feed.refresh")} disabled={busy || anyReplyBusy || revalidator.state !== "idle"} onClick={() => void revalidator.revalidate()}><RefreshCw aria-hidden className={revalidator.state !== "idle" ? "motion-safe:animate-spin" : undefined} /></Button>
          </div>}
        </div>
      </div>}
      <>
        <section aria-label={t("timeline.feed.feed")} aria-busy={revalidator.state !== "idle"} className="overflow-hidden rounded-xl border border-border bg-card">
          {!visibleItems.length ? <EmptyState variant="plain" className="p-4" title={kind ? t("timeline.feed.emptyKind") : view === "following" ? t("timeline.feed.emptyFriends") : mine || profile ? t("timeline.feed.empty") : t("timeline.feed.emptyPublic")} /> : (
            groupTimelineDays(visibleItems, root?.serverTime, locale).map((group) => <section key={group.date} aria-label={group.label}>
              <h2 className="m-0 border-b border-border bg-muted/5 px-3 py-2 text-xs font-medium text-muted sm:px-4"><time dateTime={group.date}>{group.label}</time></h2>
              <ol className="m-0 list-none divide-y divide-border/60 p-0">
                {group.entries.map(({ item, olderRenames }, index) => {
                  const onReplyBusyChange = (value: boolean) => setReplyBusy(current => ({ ...current, [item.id]: value }));
                  if (item.kind === "status" && isPostAuthorHidden(item.actor.id)) return <li key={item.id} id={`timeline-event-${item.id}`} className="scroll-mt-24 px-3 py-2 sm:px-4">
                    <StatusInteractions item={item} viewerId={viewerId} readOnly={readOnlyInteractions} hideStatus initialPage={initialReplies} onCacheError={reportCacheError} onBusyChange={onReplyBusyChange} />
                  </li>;
                  if (item.kind === "join" || item.kind === "rename") return <li key={item.id} className="px-3 py-3 sm:px-4">
                    {olderRenames
                      ? <AccountHistoryGroup item={item} olderRenames={olderRenames} showAuthor={showAuthor} />
                      : <AccountHistoryEntry item={item} showAuthor={showAuthor} />}
                  </li>;
                  const compact = !item.text && !item.images.length && item.kind !== "upload";
                  const previous = group.entries[index - 1]?.item;
                  const continued = compact && previous && previous.actor.id === item.actor.id && !previous.text && !previous.images.length && previous.kind !== "upload" && previous.kind !== "join" && previous.kind !== "rename";
                  const targetLink = item.target && <Link to={item.target.href} prefetch="none" className="font-medium text-secondary hover:underline">{item.target.title}</Link>;
                  const footer = <>
                    <Timestamp value={item.createdAt} format="duration" className="text-muted" />
                    {item.canDelete && (!profile || item.actor.id === viewerId) && <Button variant="ghost" size="sm" className="min-h-8 gap-1 px-1 text-xs font-normal text-muted" type="button" disabled={busy} onClick={() => void remove(item)} aria-label={item.kind === "status" ? t("timeline.action.postDelete") : t("timeline.action.eventRemove")}><Trash2 aria-hidden />{item.kind === "status" ? t("timeline.action.delete") : t("core.action.remove")}</Button>}
                  </>;
                  return <li key={item.id} id={`timeline-event-${item.id}`} className={cn("scroll-mt-24 px-3 sm:px-4", compact ? "py-3" : "py-4")}>
                    <article className="flex min-w-0 gap-2.5 sm:gap-3">
                      {showAuthor && (continued ? <span aria-hidden className="size-9 shrink-0" /> : <Link className="shrink-0 self-start" to={`/users/${item.actor.id}`} aria-label={t("timeline.feed.profile", { name: item.actor.displayName })}><UserAvatar avatarBlobSha256={item.actor.avatarBlobSha256} displayName={item.actor.displayName} className="size-9" size={36} /></Link>)}
                      <div className="min-w-0 flex-1">
                        {(showAuthor || item.kind !== "status") && <p className="m-0 text-sm leading-relaxed wrap-anywhere">
                          {showAuthor && <Link className="font-semibold text-secondary hover:underline" to={`/users/${item.actor.id}`}>{item.actor.displayName}</Link>}
                          {item.kind === "comment" && item.target ? <>{" "}<span className="text-muted">{t("timeline.feed.commentBefore")}</span>{targetLink}<span className="text-muted">{t("timeline.feed.commentAfter")}</span></> : <>
                            {item.kind !== "status" && <> <span className="text-muted">{t(item.kind === "upload" && item.action === "上传了新版本" ? "timeline.feed.event.version" : `timeline.feed.event.${item.kind}`)}</span> </>}
                            {targetLink}
                          </>}
                        </p>}
                        {item.text && <div className={cn((showAuthor || item.kind !== "status") && "mt-2", item.kind !== "status" && "rounded-r-md border-l-2 border-primary/20 bg-muted/5 py-2 pl-3 pr-2")}><StatusBody segments={item.body} collapse /></div>}
                        <CommentImages images={item.images} imageLabel={item.kind === "comment" ? t("image.comment") : t("timeline.feed.statusImage")} />
                        {item.work && <TimelineWorkPreview work={item.work} compact={compact} />}
                        {item.kind === "status" ? <StatusInteractions item={item} viewerId={viewerId} readOnly={readOnlyInteractions} expandReplies={expandReplies} initialPage={initialReplies} onCacheError={reportCacheError} onBusyChange={onReplyBusyChange}>{footer}</StatusInteractions> : <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                          {footer}
                        </div>}
                      </div>
                    </article>
                    {focused && inboxItemId && <InboxReadOnView itemId={inboxItemId} eventId={item.id} replyId={targetReplyId} />}
                  </li>;
                })}
              </ol>
            </section>)
          )}
        </section>
        {(hasCursor || page.nextCursor) && <nav aria-label={t("timeline.feed.pagination")} className="flex flex-wrap justify-between gap-3">
          {hasCursor ? <Button asChild variant="outline"><Link to={timelineHref(basePath, view, kind)}>{t("timeline.feed.latest")}</Link></Button> : <span />}
          {page.nextCursor && <Button asChild variant="outline"><Link to={timelineHref(basePath, view, kind, page.nextCursor)} prefetch="none">{t("timeline.feed.older")}</Link></Button>}
        </nav>}
      </>
    </div>
  );
}
