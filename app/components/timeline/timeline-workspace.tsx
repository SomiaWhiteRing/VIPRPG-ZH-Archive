import { requestJson } from "@/lib/ui/api-response";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useNavigation, useRevalidator, useRouteLoaderData } from "react-router";
import { Globe, RefreshCw, Settings, Trash2, Users } from "lucide-react";
import type { loader as rootLoader } from "@/app/root";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Label } from "@/app/components/ui/label";
import { Notice } from "@/app/components/ui/notice";
import { StatusBody, StatusEditor, type StatusEditorHandle } from "./status-editor";
import { CommentImages } from "@/app/components/comments/images";
import { StatusInteractions } from "./status-interactions";
import { TimelineWorkPreview } from "./work-preview";
import { useTimelineDraft } from "./draft-cache";
import { bodyLength } from "@/lib/face-emojis";
import { formatDate, formatDateKey, parseTimestamp } from "@/lib/format";
import { Timestamp } from "@/app/components/ui/timestamp";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { useToast } from "@/app/components/ui/toast";
import { TIMELINE_FILTER_KINDS, TIMELINE_KIND_LABELS, type TimelineItem, type TimelineKind, type TimelinePage, type TimelineSettings, type TimelineView } from "@/lib/dto/db/timeline";
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
  expandReplies?: boolean;
  canCompose?: boolean;
  canPublish?: boolean;
  hasCursor?: boolean;
};

function timelineHref(basePath: string, view: TimelineView, kind?: TimelineKind, cursor?: string | null) {
  const query = new URLSearchParams();
  if (basePath === "/timeline" || basePath === "/" || view !== "all") query.set("view", view);
  if (kind) query.set("kind", kind);
  if (cursor) query.set("cursor", cursor);
  return basePath + (query.size ? `?${query}` : "");
}

function groupTimelineDays(items: TimelineItem[], serverTime: number | undefined) {
  const today = serverTime === undefined ? null : formatDateKey(new Date(serverTime));
  const yesterday = serverTime === undefined ? null : formatDateKey(new Date(serverTime - 86400000));
  const groups: { date: string; label: string; items: TimelineItem[] }[] = [];
  for (const item of items) {
    const date = formatDateKey(parseTimestamp(item.createdAt));
    const last = groups.at(-1);
    if (last?.date === date) last.items.push(item);
    else groups.push({ date, label: date === today ? "今天" : date === yesterday ? "昨天" : formatDate(item.createdAt, { time: false }), items: [item] });
  }
  return groups;
}

async function mutateTimeline(path: string, method: string, body?: unknown) {

  await requestJson(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

}

export function TimelineWorkspace(props: Props) {
  const location = useLocation();
  return <TimelineWorkspaceContent key={`${props.viewerId}:${location.pathname}${location.search}`} {...props} />;
}

function TimelineWorkspaceContent({ page, viewerId, settings, basePath, kind, view = "all", profile = false, showAuthor = true, expandReplies = true, canCompose = false, canPublish = false, hasCursor = false }: Props) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
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
    toast.error("无法读写本地草稿，请检查浏览器存储空间或权限。");
  }, [toast]);
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
  const revalidator = useRevalidator();
  const anyReplyBusy = Object.values(replyBusy).some(Boolean);
  const allowCreate = !profile && canCompose && canPublish && settings?.enabled;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || composing.current || imageBusy || !draft.ready) return;
    const body = draft.body.trim();
    if (!body || bodyLength(body) > 500) {
      setValidation("请填写 1–500 个字符的吐槽。");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setValidation("");
    setRecovery(false);
    try {
      const imageIds = await statusEditor.current!.uploadImages();
      await mutateTimeline("/api/timeline", "POST", { body, imageIds, requestKey: draft.requestKey });
      await draft.clear();
      toast.success("吐槽已发布。");
      // Leaving is unrestricted; a finished request must not return to an old feed.
      if (!mounted.current || navigationState.current !== "idle") return;
      if (kind || hasCursor) await navigate(timelineHref(basePath, view));
      else await revalidator.revalidate();
    } catch (error) {
      setRecovery(true);
      toast.error(error instanceof Error ? error.message : "发布失败，请重试。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function remove(item: TimelineItem) {
    if (busy) return;
    await confirm("确认删除这条时间线？", {
      title: "删除时间线",
      confirmLabel: "删除",
      destructive: true,
      action: async () => {
        await mutateTimeline(`/api/timeline/${item.id}`, "DELETE");
        toast.success(item.kind === "status" ? "吐槽已删除。" : "动态已移除。");
        await revalidator.revalidate();
      },
    });
  }

  function rangeToggle(icon: boolean) {
    const following = view === "following";
    const label = following ? "当前为好友时间线，点击切换到全站时间线" : "当前为全站时间线，点击切换到好友时间线";
    return <Button variant={following ? "default" : "outline"} size={icon ? "icon" : "sm"} className={cn("h-8 min-h-8 shrink-0 rounded-full", icon ? "size-8" : "px-2 text-xs font-medium")} type="button" aria-label={label} title={label} aria-pressed={following} disabled={busy || anyReplyBusy} onClick={() => void navigate(timelineHref(basePath, following ? "all" : "following", kind))}>
      {icon ? following ? <Users aria-hidden /> : <Globe aria-hidden /> : following ? "好友时间线" : "全站时间线"}
    </Button>;
  }

  function editor() {
    const { body: value, setBody: onChange, ready } = draft;
    const id = "timeline-status";
    return (
      <form onSubmit={(event) => void submit(event)} aria-busy={busy} className="grid gap-2">
        <Label htmlFor={id} className="sr-only">说点什么</Label>
        <StatusEditor ref={statusEditor} id={id} label="吐槽内容" body={value} images={draft.images} onImagesChange={draft.setImages} onImagesBusyChange={setImageBusy} busy={busy || !ready} onChange={(body) => { onChange(body); setValidation(""); }} onError={setValidation} onCompositionChange={(value) => { composing.current = value; }} beforeCounter={viewerId && !profile ? <span className="sm:hidden">{rangeToggle(true)}</span> : undefined} actions={<>
          <Button type="submit" size="sm" disabled={busy || imageBusy || !ready || !value.trim()}>{busy ? "正在保存…" : "发布吐槽"}</Button>
        </>} />
        {validation && <Notice>{validation}</Notice>}
        {recovery && <p role="status" className="m-0 text-sm text-muted">输入已保留，可重试。如果登录已失效，请<Link className="text-primary underline" to={`/login?next=${encodeURIComponent(basePath)}`} target="_blank" rel="noopener noreferrer">在新标签页登录</Link>后回来提交。</p>}
      </form>
    );
  }

  return (
    <div className="grid w-full min-w-0 gap-3">
      {!profile && <div className="rounded-xl border border-border bg-card">
        {canCompose && !settings?.enabled && <p className="m-0 px-3 py-3 text-sm text-muted sm:px-4">时间线已停止记录业务动态。<Link className="ml-1 text-secondary hover:underline" to="/me/timeline">开启时间线</Link>，记录操作和发布吐槽。</p>}
        {canCompose && settings?.enabled && !canPublish && <p className="m-0 px-3 py-3 text-sm text-muted sm:px-4">当前账号暂时不能发布新吐槽，仍可查看动态。</p>}
        {allowCreate && <section aria-label="发布吐槽" className="p-3 sm:p-4">{editor()}</section>}
        <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] items-center gap-x-2 px-2 py-2 sm:px-3", viewerId && "sm:grid-cols-[auto_minmax(0,1fr)_auto]", canCompose && "border-t border-border")}>
          {!!viewerId && <nav aria-label="时间线范围" className="hidden min-w-0 items-center sm:flex">
            {rangeToggle(false)}
          </nav>}
          <nav aria-label="动态类型" className="flex min-w-0 items-center gap-0.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {!!viewerId && !allowCreate && <span className="mr-1 shrink-0 sm:hidden">{rangeToggle(true)}</span>}
            {[undefined, ...TIMELINE_FILTER_KINDS].map((value) => <Link key={value ?? "all"} to={timelineHref(basePath, view, value)} aria-current={kind === value ? "page" : undefined} className={cn("inline-flex h-8 shrink-0 items-center rounded-full px-2 text-xs transition-colors hover:bg-muted/10", kind === value ? "bg-primary/10 font-medium text-secondary" : "text-muted")}>{value ? TIMELINE_KIND_LABELS[value] : "全部"}</Link>)}
          </nav>
          {!!viewerId && <div className="hidden shrink-0 items-center justify-end gap-1 sm:flex">
            <Button asChild variant="ghost" size="icon" className="size-8 text-muted"><Link to="/me/timeline" aria-label="时间线设置"><Settings aria-hidden /></Link></Button>
            <Button variant="ghost" size="icon" className="size-8 text-muted" type="button" aria-label="刷新时间线" disabled={busy || anyReplyBusy || revalidator.state !== "idle"} onClick={() => void revalidator.revalidate()}><RefreshCw aria-hidden className={revalidator.state !== "idle" ? "motion-safe:animate-spin" : undefined} /></Button>
          </div>}
        </div>
      </div>}
      <>
        <section aria-label="时间线动态" aria-busy={revalidator.state !== "idle"} className="overflow-hidden rounded-xl border border-border bg-card">
          {!page.items.length ? <EmptyState variant="plain" className="p-4" title={kind ? "还没有这类动态。" : view === "following" ? "你和好友暂时没有公开动态。" : mine || profile ? "还没有公开动态。" : "还没有公开动态，来留下第一条吐槽吧。"} /> : (
            groupTimelineDays(page.items, root?.serverTime).map((group) => <section key={group.date} aria-label={group.label}>
              <h2 className="m-0 border-b border-border bg-muted/5 px-3 py-2 text-xs font-medium text-muted sm:px-4"><time dateTime={group.date}>{group.label}</time></h2>
              <ol className="m-0 list-none divide-y divide-border/60 p-0">
                {group.items.map((item, index) => {
                  if (item.kind === "join" || item.kind === "rename") return <li key={item.id} className="px-3 py-3 sm:px-4">
                    <article className="flex min-w-0 gap-2.5 sm:gap-3">
                      {showAuthor && item.kind === "rename" && <Link className="shrink-0" to={`/users/${item.actor.id}`} aria-label={`${item.actor.displayName}的个人主页`}><UserAvatar avatarBlobSha256={item.actor.avatarBlobSha256} displayName={item.actor.displayName} className="size-9" size={36} /></Link>}
                      <div className="grid min-w-0 flex-1 gap-2">
                        <p className="m-0 text-sm leading-relaxed wrap-anywhere">
                          {item.kind === "join" ? <>{showAuthor && <><strong>{item.actor.displayName}</strong> </>}加入了VIPRPG.org</> : <>由 <strong>{item.nameChange!.previousName}</strong> 改名为 <strong>{item.nameChange!.newName}</strong></>}
                        </p>
                        <Timestamp value={item.createdAt} format="duration" className="text-xs text-muted" />
                      </div>
                    </article>
                  </li>;
                  const compact = !item.text && !item.images.length && item.kind !== "upload";
                  const previous = group.items[index - 1];
                  const continued = compact && previous && previous.actor.id === item.actor.id && !previous.text && !previous.images.length && previous.kind !== "upload" && previous.kind !== "join" && previous.kind !== "rename";
                  const targetLink = item.target && <Link to={item.target.href} prefetch="none" className="font-medium text-secondary hover:underline">{item.target.title}</Link>;
                  const footer = <>
                    <Timestamp value={item.createdAt} format="duration" className="text-muted" />
                    {item.canDelete && (!profile || item.actor.id === viewerId) && <Button variant="ghost" size="sm" className="min-h-8 gap-1 px-1 text-xs font-normal text-muted" type="button" disabled={busy} onClick={() => void remove(item)} aria-label={item.kind === "status" ? "删除吐槽" : "移除动态"}><Trash2 aria-hidden />{item.kind === "status" ? "删除" : "移除"}</Button>}
                  </>;
                  return <li key={item.id} className={cn("px-3 sm:px-4", compact ? "py-3" : "py-4")}>
                    <article className="flex min-w-0 gap-2.5 sm:gap-3">
                      {showAuthor && (continued ? <span aria-hidden className="size-9 shrink-0" /> : <Link className="shrink-0" to={`/users/${item.actor.id}`} aria-label={`${item.actor.displayName}的个人主页`}><UserAvatar avatarBlobSha256={item.actor.avatarBlobSha256} displayName={item.actor.displayName} className="size-9" size={36} /></Link>)}
                      <div className="min-w-0 flex-1">
                        {(showAuthor || item.kind !== "status") && <p className="m-0 text-sm leading-relaxed wrap-anywhere">
                          {showAuthor && <Link className="font-semibold text-secondary hover:underline" to={`/users/${item.actor.id}`}>{item.actor.displayName}</Link>}
                          {item.kind === "comment" && item.target ? <><span className="text-muted"> 在 </span>{targetLink}<span className="text-muted"> 下发表了评论</span></> : <>
                            {item.kind !== "status" && <> <span className="text-muted">{item.kind === "play" ? "初次游玩了" : item.action}</span> </>}
                            {targetLink}
                          </>}
                        </p>}
                        {item.text && <div className={cn((showAuthor || item.kind !== "status") && "mt-2", item.kind !== "status" && "rounded-r-md border-l-2 border-primary/20 bg-muted/5 py-2 pl-3 pr-2")}><StatusBody segments={item.body} collapse /></div>}
                        <CommentImages images={item.images} imageLabel={item.kind === "comment" ? "评论图片" : "吐槽图片"} />
                        {item.work && <TimelineWorkPreview work={item.work} compact={compact} />}
                        {item.kind === "status" ? <StatusInteractions item={item} viewerId={viewerId} readOnly={profile} expandReplies={expandReplies} onCacheError={reportCacheError} onBusyChange={(value) => setReplyBusy((current) => ({ ...current, [item.id]: value }))}>{footer}</StatusInteractions> : <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                          {footer}
                        </div>}
                      </div>
                    </article>
                  </li>;
                })}
              </ol>
            </section>)
          )}
        </section>
        {(hasCursor || page.nextCursor) && <nav aria-label="时间线分页" className="flex flex-wrap justify-between gap-3">
          {hasCursor ? <Button asChild variant="outline"><Link to={timelineHref(basePath, view, kind)}>返回最新</Link></Button> : <span />}
          {page.nextCursor && <Button asChild variant="outline"><Link to={timelineHref(basePath, view, kind, page.nextCursor)} prefetch="none">更早的动态</Link></Button>}
        </nav>}
      </>
    </div>
  );
}
