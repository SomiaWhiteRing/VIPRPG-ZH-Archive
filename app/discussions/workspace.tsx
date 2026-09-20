import { Timestamp } from "@/app/components/ui/timestamp";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { useToast } from "@/app/components/ui/toast";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { ClientOnly } from "@/app/components/ui/client-only";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import type { FaceEmoji } from "@/lib/dto/db/work-community";
import type {
  ForumContent,
  ForumDetail,
  ForumFloor,
  ForumPage,
  ForumTag,
  ForumTarget,
  ForumTopic,
  ForumViewer,
} from "@/lib/forum";
import { FORUM_PREVIEW_SIZE, forumHref, forumTargetHref } from "@/lib/forum";
import type { PublicForumContent } from "@/lib/forum-public";
import { interactiveContent } from "@/lib/forum-state";
import { cn } from "@/lib/ui/cn";
import { MessageSquare, ThumbsUp } from "lucide-react";
import {
  Fragment,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useNavigationType,
  useRevalidator,
} from "react-router";
import type { ForumDialogAction, ForumMenuItem } from "./actions";
import { ForumActionDialog, ForumMenu } from "./actions";
import type { ForumDraft } from "./draft";
import {
  draftSnapshot,
  draftValue,
  forumReplyLauncherClass,
} from "./draft";
import { ForumImages, existingDraftImages, uploadDraftImages } from "./images";
import { ForumReplyBar } from "./reply-bar";
import {
  ForumAuthorName,
  ForumBody,
  ForumRequestError,
  PopularTagFilter,
  TopicStatus,
  TopicTags,
  forumRequest,
  readForumEditVersion,
  referencedForumEmojis,
} from "./shared";
import { useDiscussionVisit } from "./visit";
const ForumEditor = lazy(() =>
  import("./editor").then((module) => ({ default: module.ForumEditor })),
);

type Props = {
  viewer: ForumViewer;
  emojis: FaceEmoji[];
  initialDetail?: ForumDetail;
  topics?: ForumPage<ForumTopic>;
  selected?: ForumTag[];
  popular?: ForumTag[];
  featured?: boolean;
  filterError?: string;
  returnTo?: string;
  initialReply?: "topic" | number;
};
function normalizedLocation(href: string) {
  const url = new URL(href, "https://forum.invalid");
  url.searchParams.sort();
  return url.pathname + url.search + url.hash;
}
function createDraft(
  mode: ForumDraft["mode"],
  title: string,
  post?: ForumContent,
  reply?: ForumContent,
): ForumDraft {
  const draft: Omit<ForumDraft, "original"> = {
    editorId: crypto.randomUUID(),
    mode,
    postId: post?.postId,
    postNumber: post?.postNumber,
    replyToId: reply?.id,
    replyName: reply?.author?.name,
    title,
    body: "",
    images: [],
    tags: [],
    requestKey: crypto.randomUUID(),
  };
  return { ...draft, original: draftSnapshot(draft) };
}
export function DiscussionWorkspace({
  viewer,
  emojis,
  initialDetail,
  topics,
  selected = [],
  popular = [],
  featured = false,
  filterError,
  returnTo,
  initialReply,
}: Props) {
  const location = useLocation();
  const toast = useToast();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [currentEmojis, setCurrentEmojis] = useState(emojis);
  useEffect(() => {
    setCurrentEmojis(emojis);
  }, [emojis]);
  const [pending, startTransition] = useTransition();
  useDiscussionVisit(initialDetail?.topic.id);
  const [detail, setDetail] = useState(initialDetail),
    [draft, setDraft] = useState<ForumDraft | null>(() => {
      if (!viewer || !initialDetail || !initialReply) return null;
      if (initialReply === "topic")
        return initialDetail.topic.capabilities.reply
          ? createDraft("post", initialDetail.topic.title)
          : null;
      const post = initialDetail.posts.items.find(
        (item) => item.postNumber === initialReply,
      );
      return post?.capabilities.reply
        ? createDraft("comment", initialDetail.topic.title, post)
        : null;
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestError, setRequestError] = useState<ForumRequestError | null>(null);
  const [action, setAction] = useState<ForumDialogAction | null>(null),
    [confirm, setConfirm] = useState<{
      resolve: (value: boolean) => void;
    } | null>(null),
    [unavailable, setUnavailable] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLElement>(null);
  const handledNavigation = useRef<string | null>(null);
  const localNavigation = useRef<{
    href: string;
    targetId: string | null;
  } | null>(null);
  const removalFocus = useRef<{ targetId: string | null } | null>(null);
  const [replyOccupancy, setReplyOccupancy] = useState<number | null>(null);
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || replyOccupancy === null) return;
    // The discussion page owns document scrolling and its own bottom clearance.
    const root = document.documentElement;
    const originalPadding = root.style.scrollPaddingBottom;
    page.style.setProperty("--forum-reply-clearance", `${replyOccupancy}px`);
    root.style.scrollPaddingBottom = `${replyOccupancy + 16}px`;
    return () => {
      root.style.scrollPaddingBottom = originalPadding;
      page.style.removeProperty("--forum-reply-clearance");
    };
  }, [replyOccupancy]);
  const [detailSource, setDetailSource] = useState(initialDetail);
  // Render new route data together with its URL, before any focus effect runs.
  if (detailSource !== initialDetail) {
    setDetailSource(initialDetail);
    setDetail(initialDetail);
    setUnavailable(false);
  }
  const [uploadProgress, setUploadProgress] = useState("");
  const dirty = !!draft && draftValue(draft) !== draftValue(draft.original);
  const listHref = forumHref("/discussions", {
    view: featured ? "featured" : null,
    tag: selected.map((tag) => tag.id),
    page: topics?.page,
  });
  const listReturn = detail ? returnTo : listHref;
  const protectedRef = useRef({ dirty, busy });
  useEffect(() => {
    protectedRef.current = { dirty, busy };
  }, [dirty, busy]);
  const ask = useCallback(
    () => new Promise<boolean>((resolve) => setConfirm({ resolve })),
    [],
  );
  const navigateAccepted = useNavigationGuard(dirty || busy, async () => {
    if (protectedRef.current.busy) return false;
    if (!protectedRef.current.dirty) return true;
    if (!(await ask())) return false;
    protectedRef.current.dirty = false;
    setDraft(null);
    return true;
  });
  useEffect(() => {
    const page = pageRef.current;
    if (!detail || !page || handledNavigation.current === location.key) return;
    const firstNavigation = handledNavigation.current === null;
    if (initialReply) {
      handledNavigation.current = location.key;
      const params = new URLSearchParams(location.search);
      params.delete("reply");
      const href =
        location.pathname + (params.size ? `?${params}` : "") + location.hash;
      // URL housekeeping must not steal focus from the lazy reply editor.
      localNavigation.current = { href: normalizedLocation(href), targetId: null };
      void navigateAccepted(href, { replace: true, preventScrollReset: true });
      return;
    }
    const href = normalizedLocation(
      location.pathname + location.search + location.hash,
    );
    const local =
      localNavigation.current?.href === href ? localNavigation.current : null;
    if (local && !local.targetId) {
      handledNavigation.current = location.key;
      localNavigation.current = null;
      return;
    }
    const targetId = local
      ? local.targetId
      : location.hash.slice(1) ||
        (detail.comment
          ? `comment-${detail.comment}`
          : detail.floor
            ? `post-${detail.floor}`
            : "");
    const element = targetId
      ? page.querySelector<HTMLElement>(`#${CSS.escape(targetId)}`)
      : page.querySelector<HTMLElement>("[data-forum-post]");
    if (element) {
      handledNavigation.current = location.key;
      localNavigation.current = null;
      element.focus({ preventScroll: true });
      // Hash scrolling belongs to ScrollRestoration. Only query-based targets
      // need an explicit scroll; local comment pagination keeps its position.
      if (
        targetId &&
        !local &&
        !location.hash &&
        (firstNavigation || navigationType !== "POP")
      )
        element.scrollIntoView({
          block: "center",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
    }
  }, [detail, initialReply, location, navigateAccepted, navigationType]);
  useEffect(() => {
    const request = removalFocus.current;
    const page = pageRef.current;
    if (!request || !page) return;
    removalFocus.current = null;
    // Restore a useful focus only if the removed control left it on the body.
    if (document.activeElement !== document.body) return;
    const parent = request.targetId
      ? page.querySelector<HTMLElement>(`#${request.targetId}`)
      : null;
    (parent ?? page).focus({ preventScroll: true });
  }, [detail, unavailable]);
  async function refreshDetail(removed?: ForumTarget, hidden = false) {
    if (!detail) {
      startTransition(() => revalidator.revalidate());
      return;
    }
    try {
      const params = new URLSearchParams(location.search);
      if (removed) {
        params.delete("comment");
        if (removed.kind !== "comment" && hidden) {
          params.delete("floor");
          params.delete("commentPage");
        }
        const href = location.pathname + (params.size ? `?${params}` : "");
        localNavigation.current = {
          href: normalizedLocation(href),
          targetId: null,
        };
        await navigateAccepted(href, { replace: true, preventScrollReset: true });
      }
      const result = await forumRequest<{
        detail: ForumDetail;
        emojis: FaceEmoji[];
      }>(
        forumHref("/api/discussions", {
          op: "detail",
          topicId: detail.topic.id,
          page: params.get("page"),
          floor: params.get("floor"),
          commentPage: params.get("commentPage"),
          comment: params.get("comment"),
        }),
      );
      if (removed) {
        const parent = detail.posts.items.find((post) =>
          removed.kind === "comment"
            ? [...post.comments.items, ...post.commentPreview].some(
                (comment) => comment.id === removed.id,
              )
            : post.id === removed.id,
        );
        removalFocus.current = {
          targetId: parent ? `post-${parent.postNumber}` : null,
        };
      }
      setCurrentEmojis(result.emojis);
      setDetail(result.detail);
    } catch (e) {
      if (e instanceof ForumRequestError && e.status === 404) {
        if (removed) removalFocus.current = { targetId: null };
        setUnavailable(true);
      } else toast.error(e instanceof Error ? e.message : "加载失败。");
    }
  }
  async function switchDraft(next: ForumDraft | null) {
    if (busy) return;
    if (dirty && !(await ask())) return;
    if (next) trigger.current = document.activeElement as HTMLElement;
    setDraft(next);
    setError("");
    setRequestError(null);
    if (!next) trigger.current?.focus();
  }
  function newDraft(
    mode: ForumDraft["mode"],
    post?: ForumContent,
    reply?: ForumContent,
  ) {
    void switchDraft(
      createDraft(
        mode,
        mode === "topic" ? "" : (detail?.topic.title ?? ""),
        post,
        reply,
      ),
    );
  }
  async function edit(content: ForumContent) {
    if (busy) return;
    if (dirty && !(await ask())) return;
    trigger.current = document.activeElement as HTMLElement;
    try {
      const target: ForumTarget =
        content.kind === "post" && content.postNumber === 1
          ? { kind: "topic", id: content.topicId }
          : { kind: content.kind, id: content.id };
      const result = await readForumEditVersion(target);
      const next: Omit<ForumDraft, "original"> = {
        editorId: crypto.randomUUID(),
        mode: target.kind,
        target,
        postId: content.postId,
        postNumber: content.postNumber,
        title: result.topic.title,
        body: result.body,
        images: existingDraftImages(result.images),
        tags: result.topic.tags.map((t) => t.name),
        revision: result.revision,
        topicRevision: result.topic.revision,
        requestKey: crypto.randomUUID(),
      };
      setDraft({ ...next, original: draftSnapshot(next) });
      setError("");
      setRequestError(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取失败。");
    }
  }
  async function submitDraft() {
    if (
      !draft ||
      busy ||
      draft.currentVersion ||
      (draft.target && requestError?.code === "forum_conflict")
    )
      return;
    setBusy(true);
    setError("");
    setRequestError(null);
    try {
      const imageIds = await uploadDraftImages(
        draft.images,
        {
          mode: draft.mode,
          topicId: detail?.topic.id,
          targetId: draft.target?.id,
        },
        (images, progress) => {
          setDraft((current) => (current ? { ...current, images } : current));
          setUploadProgress(progress);
        },
      );
      setUploadProgress("");
      const result = await forumRequest<{ href: string; topicId: number }>(
        "/api/discussions",
        {
          op: draft.target ? "edit" : "publish",
          kind: draft.mode,
          target: draft.target,
          topicId: detail?.topic.id,
          postId: draft.postId,
          replyToId: draft.replyToId,
          title: draft.title,
          body: draft.body,
          images: imageIds,
          imageOffsets: draft.images.map((image) => image.offset),
          tags: draft.tags,
          tagsChanged:
            JSON.stringify(draft.original.tags) !== JSON.stringify(draft.tags),
          revision: draft.revision,
          topicRevision: draft.topicRevision,
          requestKey: draft.requestKey,
        },
      );
      protectedRef.current = { dirty: false, busy: false };
      setDraft(null);
      toast.success(
        draft.target
          ? "修改已保存。"
          : draft.mode === "topic"
            ? "主题已发布。"
            : "回复已发表。",
      );
      const destination = new URL(result.href, window.location.origin);
      if (listReturn && listReturn !== "/discussions")
        destination.searchParams.set("from", listReturn);
      if (detail?.topic.id === result.topicId) {
        await navigateAccepted(
          destination.pathname + destination.search + destination.hash,
          { preventScrollReset: true },
        );
      } else {
        navigate(destination.pathname + destination.search + destination.hash);
      }
    } catch (e) {
      setError(
        e instanceof ForumRequestError && e.status === 0
          ? "网络连接失败，内容已保留，请重试。"
          : e instanceof Error
            ? e.message
            : "发布失败，请重试。",
      );
      if (e instanceof ForumRequestError) setRequestError(e);
    } finally {
      setBusy(false);
    }
  }
  async function reloadEditor() {
    if (!draft?.target || busy) return;
    setBusy(true);
    try {
      const result = await readForumEditVersion(draft.target);
      setError("");
      setDraft({ ...draft, currentVersion: result });
      setRequestError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败。");
    } finally {
      setBusy(false);
    }
  }
  async function openAction(next: ForumDialogAction) {
    if (busy) return;
    if (dirty && !(await ask())) return;
    setDraft(null);
    setAction(next);
  }
  function menu(content: ForumContent): ForumMenuItem[] {
    if (!detail) return [];
    const target: ForumTarget =
      content.kind === "post" && content.postNumber === 1
        ? { kind: "topic", id: content.topicId }
        : { kind: content.kind, id: content.id };
    const base = {
      target,
      summary: `${detail.topic.title} · #${content.postNumber}${content.kind === "comment" ? " 楼中楼" : ""}`,
      topicRevision: detail.topic.revision,
    };
    const items: ForumMenuItem[] = [];
    if (content.capabilities.edit)
      items.push({ label: "编辑", run: () => void edit(content) });
    if (content.capabilities.delete)
      items.push({
        label: "删除",
        danger: true,
        run: () => void openAction({ ...base, kind: "delete" }),
      });
    if (content.capabilities.report)
      items.push({
        label: "举报",
        run: () => void openAction({ ...base, kind: "report" }),
      });
    if (content.capabilities.moderate)
      items.push({
        label: content.state === "hidden" ? "恢复" : "隐藏",
        run: () =>
          void openAction({
            ...base,
            kind: "moderate",
            action: content.state === "hidden" ? "restore" : "hide",
          }),
      });
    return items;
  }
  const topic = detail?.topic;
  const topicMenu: ForumMenuItem[] = topic
    ? [
        ...(topic.capabilities.edit
          ? [
              {
                label: "编辑主题",
                run: () => {
                  void forumRequest<{ detail: ForumDetail }>(
                    forumHref("/api/discussions", {
                      op: "detail",
                      topicId: topic.id,
                    }),
                  )
                    .then((r) => edit(r.detail.posts.items[0]))
                    .catch((e) => toast.error(e.message));
                },
              },
            ]
          : []),
        ...(viewer
          ? [
              {
                label: "请求处理",
                run: () =>
                  void openAction({
                    kind: "report",
                    request: true,
                    target: { kind: "topic", id: topic.id },
                    summary: topic.title,
                    topicRevision: topic.revision,
                  }),
              },
            ]
          : []),
        ...(topic.capabilities.delete
          ? [
              {
                label: "删除主题",
                danger: true,
                run: () =>
                  void openAction({
                    kind: "delete",
                    target: { kind: "topic", id: topic.id },
                    summary: topic.title,
                    topicRevision: topic.revision,
                  }),
              },
            ]
          : []),
        ...(topic.capabilities.moderate
          ? (
              [
                { label: topic.pinned ? "取消置顶" : "置顶", action: topic.pinned ? "unpin" : "pin" },
                { label: "隐藏主题", action: "hide" },
                {
                  label: topic.locked ? "解锁" : "锁定",
                  action: topic.locked ? "unlock" : "lock",
                },
              ] as const
            ).map((item) => ({
              label: item.label,
              run: () =>
                void openAction({
                  kind: "moderate",
                  target: { kind: "topic", id: topic.id },
                  summary: topic.title,
                  topicRevision: topic.revision,
                  action: item.action,
                }),
            }))
          : []),
        ...(topic.capabilities.feature
          ? (
              [
                {
                  label: topic.featured ? "取消加精" : "加精",
                  action: topic.featured ? "unfeature" : "feature",
                },
                { label: "调整 TAG", action: "tags" },
              ] as const
            ).map((item) => ({
              label: item.label,
              run: () =>
                void openAction({
                  kind: "moderate",
                  target: { kind: "topic", id: topic.id },
                  summary: topic.title,
                  topicRevision: topic.revision,
                  action: item.action,
                  tags: topic.tags.map((t) => t.name),
                }),
            }))
          : []),
      ]
    : [];
  // Let the router finish removing the reply parameter before the editor mounts
  // and takes focus through its own textarea/Tiptap lifecycle.
  const editor = draft && !initialReply ? (
    <ClientOnly>
      <ForumEditor
        key={draft.editorId}
        draft={draft}
        onChange={(next) => {
          if (draftValue(next) !== draftValue(draft))
            next.requestKey = crypto.randomUUID();
          setDraft(next);
        }}
        onBusyChange={(value) => {
          protectedRef.current.busy = value;
          setBusy(value);
        }}
        onError={setError}
        onCancel={() => void switchDraft(null)}
        onSubmit={() => void submitDraft()}
        onReload={() => void reloadEditor()}
        busy={busy}
        error={error}
        progress={uploadProgress}
        loginExpired={requestError?.status === 401}
        conflict={!!draft.target && requestError?.code === "forum_conflict"}
        emojis={currentEmojis}
      />
    </ClientOnly>
  ) : null;
  const replyBar =
    detail && !unavailable && draft?.mode !== "topic" ? (
      <ForumReplyBar viewer={viewer} onOccupancyChange={setReplyOccupancy}>
        {draft?.mode === "post" ? (
          editor
        ) : detail.topic.locked ? (
          <p className="py-2 text-sm text-muted">
            主题已锁定，不能继续回复。
          </p>
        ) : viewer ? (
          <Button
            variant="ghost"
            className={forumReplyLauncherClass}
            onClick={() => newDraft("post")}
            type="button"
            disabled={busy || !detail.topic.capabilities.reply}
          >
            {detail.topic.capabilities.reply
              ? "回复主题……"
              : "当前主题不可回复"}
          </Button>
        ) : (
          <Link
            className={forumReplyLauncherClass}
            to={`/login?next=${encodeURIComponent(
              forumHref(`/discussions/${detail.topic.id}`, {
                page: detail.posts.page,
                floor: detail.floor,
                commentPage: detail.posts.items.find(
                  (post) => post.postNumber === detail.floor,
                )?.comments.page,
                comment: detail.comment,
                from: returnTo,
                reply: "topic",
              }),
            )}`}
          >
            登录后发表回复
          </Link>
        )}
      </ForumReplyBar>
    ) : null;
  async function listNavigate(nextFeatured: boolean, tags: ForumTag[]) {
    if (busy) return;
    if (dirty && !(await ask())) return;
    protectedRef.current.dirty = false;
    setDraft(null);
    startTransition(() =>
      navigate(
        forumHref("/discussions", {
          view: nextFeatured ? "featured" : null,
          tag: tags.map((t) => t.id).sort((a, b) => a - b),
        }),
      ),
    );
  }
  const Container = detail || unavailable ? "main" : PageContainer;
  return (
    <Container
      ref={pageRef}
      data-forum-page
      tabIndex={-1}
      className={
        detail || unavailable
          ? "mx-auto w-[min(1180px,calc(100vw-2rem))] pt-4 pb-[calc(1rem+var(--forum-reply-clearance,0px))]"
          : undefined
      }
    >
      {unavailable ? (
        <>
          <PageHeader compact title="内容不可用" />
          <Link to={returnTo ?? "/discussions"}>返回讨论版</Link>
        </>
      ) : detail ? (
        <>
          <Link
            className="mb-4 inline-block text-sm text-primary"
            to={returnTo ?? "/discussions"}
          >
            ← 返回讨论版
          </Link>
          <div className="mb-2 text-sm leading-relaxed">
            <TopicTags tags={detail.topic.tags} />
          </div>
          <PageHeader
            compact
            title={detail.topic.title}
            actions={
              <>
                <TopicStatus topic={detail.topic} />
                <ForumMenu items={topicMenu} />
              </>
            }
            subtitle={
              <>
                由 <ForumAuthorName author={detail.topic.author} /> 发布 ·{" "}
                <Timestamp value={detail.topic.createdAt} />
              </>
            }
          />
          <section aria-label="帖子流">
            {detail.posts.items.map((post, index) => (
              <Fragment key={post.id}>
                <ForumFloorView
                  key={post.id}
                  post={post}
                  topic={detail.topic}
                  emojis={currentEmojis}
                  viewer={viewer}
                  page={detail.posts.page}
                  returnTo={returnTo}
                  onLocationChange={(href, replace, targetId) => {
                    localNavigation.current = {
                      href: normalizedLocation(href),
                      targetId: targetId ?? null,
                    };
                    void navigate(href, { replace, preventScrollReset: true });
                  }}
                  initialExpanded={detail.floor === post.postNumber}
                  menu={menu}
                  onReply={(parent, reply) =>
                    newDraft("comment", parent, reply)
                  }
                  editor={
                    draft?.mode === "comment" && draft.postId === post.id
                      ? editor
                      : null
                  }
                />
                {index === 0 ? replyBar : null}
              </Fragment>
            ))}
            {!detail.posts.items.length ? replyBar : null}
          </section>
          <PaginationLinks
            basePath={`/discussions/${detail.topic.id}`}
            page={detail.posts.page}
            pageSize={detail.posts.pageSize}
            total={detail.posts.total}
            params={{ from: returnTo }}
          />
        </>
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[192px_minmax(0,1fr)]">
          <aside className="hidden self-start lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
            <h2 className="mb-4 font-bold">讨论版</h2>
            <nav className="grid gap-2" aria-label="讨论版导航">
              {[false, true].map((value) => (
                <Link
                  key={String(value)}
                  className={`rounded-md px-3 py-2 ${featured === value ? "bg-primary/10 font-bold text-primary" : ""}`}
                  aria-current={featured === value ? "page" : undefined}
                  to={forumHref("/discussions", {
                    view: value ? "featured" : null,
                    tag: selected.map((t) => t.id),
                  })}
                >
                  {value ? "精品" : "最新"}
                </Link>
              ))}
            </nav>
            <h3 className="mb-2 mt-6 text-sm font-bold">常用 TAG</h3>
            <PopularTagFilter
              popular={popular}
              selected={selected}
              hrefForTags={(tags) =>
                forumHref("/discussions", {
                  view: featured ? "featured" : null,
                  tag: tags.map((tag) => tag.id).sort((a, b) => a - b),
                })
              }
              onChange={(tags) => listNavigate(featured, tags)}
              disabled={pending}
            />
          </aside>
          <div className="min-w-0">
            <span className="sr-only" role="status">
              {pending ? "正在更新讨论…" : ""}
            </span>
            <PageHeader
              compact
              title="讨论版"
              actions={
                viewer ? (
                  <Button type="button" onClick={() => newDraft("topic")}>
                    发布主题
                  </Button>
                ) : (
                  <Link to="/login?next=%2Fdiscussions">登录后发布</Link>
                )
              }
            />
            <div className="my-3 flex flex-wrap items-center gap-2 lg:hidden">
              {[false, true].map((value) => (
                <Button
                  key={String(value)}
                  type="button"
                  variant={featured === value ? "default" : "ghost"}
                  disabled={pending}
                  aria-current={featured === value ? "page" : undefined}
                  onClick={() => listNavigate(value, selected)}
                >
                  {value ? "精品" : "最新"}
                </Button>
              ))}
            </div>
            <div className="my-3 min-w-0 lg:hidden">
              <PopularTagFilter
                popular={popular}
                selected={selected}
                hrefForTags={(tags) =>
                  forumHref("/discussions", {
                    view: featured ? "featured" : null,
                    tag: tags.map((tag) => tag.id).sort((a, b) => a - b),
                  })
                }
                onChange={(tags) => listNavigate(featured, tags)}
                disabled={pending}
              />
            </div>
            <div className="my-3 flex flex-wrap gap-2">
              {selected.map((tag) => (
                <Button
                  type="button"
                  key={tag.id}
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    listNavigate(
                      featured,
                      selected.filter((t) => t.id !== tag.id),
                    )
                  }
                >
                  [{tag.name}] ×
                </Button>
              ))}
            </div>
            {filterError ? (
              <p role="alert" className="text-destructive">
                {filterError}
              </p>
            ) : topics?.items.length ? (
              <section aria-label="讨论主题" aria-busy={pending}>
                <div className="hidden grid-cols-[minmax(0,1fr)_72px_96px] gap-2 border-b border-border py-2 text-right text-xs text-muted md:grid lg:grid-cols-[minmax(0,1fr)_72px_72px_96px]">
                  <span />
                  <span>回复</span>
                  <span className="hidden lg:block">浏览</span>
                  <span>活跃</span>
                </div>
                {topics.items.map((item) => (
                  <article
                    className="grid min-w-0 gap-2 border-b border-border py-4 hover:bg-primary/5 focus-within:bg-primary/5 md:grid-cols-[minmax(0,1fr)_72px_96px] md:items-center lg:grid-cols-[minmax(0,1fr)_72px_72px_96px]"
                    key={item.id}
                  >
                    <div className="min-w-0">
                      {item.tags.length > 0 || item.featured || item.pinned || item.locked ? (
                        <div className="mb-1 break-words text-sm">
                          <TopicTags tags={item.tags} />
                          <TopicStatus topic={item} />
                        </div>
                      ) : null}
                      <Link
                        className="line-clamp-2 break-words font-bold text-foreground hover:text-primary"
                        to={forumHref(`/discussions/${item.id}`, {
                          from: listHref === "/discussions" ? null : listHref,
                        })}
                      >
                        {item.title}
                      </Link>
                      <div className="mt-2 text-xs text-muted">
                        <ForumAuthorName author={item.author} />
                        <span className="md:hidden">
                          {" "}
                          · {item.replies} 回复 ·{" "}
                          <Timestamp value={item.activeAt} />
                        </span>
                        {item.lastAuthor &&
                        item.lastAuthor.id !== item.author.id ? (
                          <span className="hidden md:inline">
                            {" "}
                            · 最后回复：
                            <ForumAuthorName author={item.lastAuthor} />
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span className="hidden text-right font-mono text-sm tabular-nums md:block">
                      {item.replies}
                    </span>
                    <span className="hidden text-right font-mono text-sm tabular-nums lg:block">
                      {item.views}
                    </span>
                    <span className="hidden text-right md:flex md:items-center md:justify-end">
                      <Timestamp value={item.activeAt} />
                    </span>
                  </article>
                ))}
              </section>
            ) : (
              <EmptyState
                title={
                  selected.length
                    ? "这个 TAG 下还没有主题。"
                    : featured
                      ? "还没有精品主题。"
                      : "还没有主题。"
                }
              />
            )}
            {topics ? (
              <PaginationLinks
                basePath="/discussions"
                page={topics.page}
                pageSize={topics.pageSize}
                total={topics.total}
                params={{
                  view: featured ? "featured" : undefined,
                  tag: selected.map((tag) => String(tag.id)),
                }}
              />
            ) : null}
          </div>
        </div>
      )}
      {draft?.mode === "topic" ? editor : null}
      {action ? (
        <ForumActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={() => {
            toast.success(
              action.kind === "report"
                ? "已提交，处理结果不会公开显示。"
                : "操作已保存。",
            );
            void refreshDetail(
              action.kind === "delete" || action.action === "hide"
                ? action.target
                : undefined,
              action.action === "hide",
            );
          }}
        />
      ) : null}
      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) {
            confirm?.resolve(false);
            setConfirm(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>舍弃当前未保存内容？</AlertDialogTitle>
          <AlertDialogDescription>舍弃后无法恢复。</AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline" type="button">
                取消
              </Button>
            </AlertDialogCancel>
            <Button
              variant="destructive"
              type="button"
              onClick={() => {
                confirm?.resolve(true);
                setConfirm(null);
              }}
            >
              舍弃
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Container>
  );
}

function ForumFloorView({
  post,
  topic,
  viewer,
  page,
  returnTo,
  emojis,
  initialExpanded,
  menu,
  onReply,
  editor,
  onLocationChange,
}: {
  post: ForumFloor;
  topic: ForumTopic;
  viewer: ForumViewer;
  page: number;
  returnTo?: string;
  emojis: FaceEmoji[];
  initialExpanded: boolean;
  menu: (content: ForumContent) => ForumMenuItem[];
  onReply: (parent: ForumContent, reply?: ForumContent) => void;
  editor: React.ReactNode;
  onLocationChange: (href: string, replace?: boolean, targetId?: string) => void;
}) {
  const location = useLocation();
  const toast = useToast();
  const [expanded, setExpanded] = useState(initialExpanded),
    [commentEmojis, setCommentEmojis] = useState(emojis),
    [comments, setComments] = useState(post.comments),
    [preview, setPreview] = useState(post.commentPreview),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [liked, setLiked] = useState(post.liked),
    [likes, setLikes] = useState(post.likes),
    [liking, setLiking] = useState(false);
  const [contentSource, setContentSource] = useState({
    post,
    emojis,
    initialExpanded,
  });
  // Commit the requested comment page before the router restores hash scrolling.
  if (
    contentSource.post !== post ||
    contentSource.emojis !== emojis ||
    contentSource.initialExpanded !== initialExpanded
  ) {
    setContentSource({ post, emojis, initialExpanded });
    setComments(post.comments);
    setPreview(post.commentPreview);
    setLiked(post.liked);
    setLikes(post.likes);
    setCommentEmojis(emojis);
    if (initialExpanded) setExpanded(true);
  }
  async function load(page: number) {
    setLoading(true);
    setError("");
    try {
      const result = await forumRequest<{
        comments: ForumPage<PublicForumContent>;
      }>(
        forumHref("/api/discussions", {
          op: "comments",
          postId: post.id,
          page,
        }),
      );
      const mapped = {
        ...result.comments,
        items: result.comments.items.map((item) => {
          const content = interactiveContent(item, topic, viewer);
          content.capabilities.reply &&= post.state === "published";
          return content;
        }),
      };
      setCommentEmojis(
        await referencedForumEmojis(mapped.items.map((item) => item.body)),
      );
      setComments(mapped);
      if (result.comments.page === 1)
        setPreview(mapped.items.slice(0, FORUM_PREVIEW_SIZE));
      setExpanded(true);
      const params = new URLSearchParams(location.search);
      params.set("floor", String(post.postNumber));
      params.delete("comment");
      if (result.comments.page === 1) params.delete("commentPage");
      else params.set("commentPage", String(result.comments.page));
      onLocationChange(
        `${location.pathname}?${params}`,
        false,
        `floor-comments-${post.id}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败。");
    } finally {
      setLoading(false);
    }
  }
  async function toggleLike() {
    if (liking) return;
    setLiking(true);
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      const result = await forumRequest<{ liked: boolean; likes: number }>(
        "/api/discussions",
        { op: "like", postId: post.id, liked: next },
      );
      setLiked(result.liked);
      setLikes(result.likes);
    } catch (e) {
      setLiked(!next);
      setLikes((n) => n + (next ? -1 : 1));
      toast.error(e instanceof Error ? e.message : "点赞失败。");
    } finally {
      setLiking(false);
    }
  }
  const visibleComments = expanded ? comments.items : preview;
  return (
    <article
      className="scroll-mt-24 border-b border-border py-6 focus-visible:outline focus-visible:outline-primary target:bg-primary/5 md:grid md:grid-cols-[136px_minmax(0,1fr)] md:gap-6"
      id={`post-${post.postNumber}`}
      tabIndex={-1}
      data-forum-post
    >
      <div className="mb-3 flex min-w-0 items-center gap-2 md:mb-0 md:block">
        {post.author ? (
          <>
            <UserAvatar
              displayName={post.author.name}
              avatarBlobSha256={post.author.avatar}
              className="size-8 md:mb-2 md:size-10"
            />
            <div className="min-w-0 break-words text-sm">
              <ForumAuthorName author={post.author} />
            </div>
          </>
        ) : null}
      </div>
      <div className="min-w-0">
        {post.body !== null ? (
          <>
            <ForumImages
              body={post.body || (post.images.length ? "" : "图片已移除。")}
              images={post.images}
              emojis={emojis}
            />
          </>
        ) : (
          <p className="text-sm text-muted">
            {post.state === "deleted"
              ? "该回复已删除。"
              : post.state === "hidden"
                ? "该回复已由管理员隐藏。"
                : "内容不可用。"}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted">
          <span className="flex flex-wrap items-center gap-1">
            <Link
              to={forumTargetHref(
                { kind: "post", id: post.id },
                topic.id,
                post.postNumber,
              )}
              className="font-mono hover:text-primary"
            >
              #{post.postNumber}
            </Link>
            <span>·</span>
            <Timestamp value={post.createdAt} />
            {post.editedAt ? " · 已编辑" : ""}
          </span>
          <div className="ml-auto flex items-center gap-0">
            {post.capabilities.like || post.body !== null ? (
              <Button
                className={cn(
                  "min-h-10 px-2",
                  !post.capabilities.like && "disabled:opacity-100",
                )}
                size="sm"
                variant="ghost"
                type="button"
                disabled={!post.capabilities.like || liking}
                aria-label={
                  liked ? `取消赞，${likes} 个赞` : `赞，${likes} 个赞`
                }
                aria-pressed={liked}
                onClick={() => void toggleLike()}
              >
                <ThumbsUp
                  aria-hidden
                  className={liked ? "size-4 text-primary" : "size-4"}
                />
                <span className={liked ? "text-primary" : undefined}>
                  {likes || "赞"}
                </span>
              </Button>
            ) : null}
            {post.capabilities.reply ? (
              <Button
                className="min-h-10 px-2"
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => onReply(post)}
              >
                <MessageSquare className="size-4" />
                回复
              </Button>
            ) : null}
            {!viewer && post.body !== null && !topic.locked ? (
              <Link
                className="p-2 text-sm text-primary"
                to={`/login?next=${encodeURIComponent(
                  forumHref(`/discussions/${topic.id}`, {
                    page,
                    floor: post.postNumber,
                    commentPage: comments.page,
                    from: returnTo,
                    reply: post.postNumber,
                  }) + `#post-${post.postNumber}`,
                )}`}
              >
                登录后回复
              </Link>
            ) : null}
            <ForumMenu items={menu(post)} />
          </div>
        </div>
        {post.commentsAvailable && (post.comments.total > 0 || editor) ? (
          <section
            id={`floor-comments-${post.id}`}
            aria-label={`#${post.postNumber}的回复`}
            tabIndex={-1}
            className="mt-3 border-l-2 border-border bg-muted/10 p-2 focus-visible:outline focus-visible:outline-primary sm:p-3"
          >
            {visibleComments.map((comment) => (
              <article
                key={comment.id}
                id={`comment-${comment.id}`}
                tabIndex={-1}
                className="group scroll-mt-24 border-b border-border/50 py-2 focus-visible:outline focus-visible:outline-primary target:bg-primary/5"
              >
                <div className="break-words text-sm leading-relaxed">
                  {comment.author ? (
                    <>
                      <ForumAuthorName author={comment.author} />
                      {comment.replyTo ? (
                        <>
                          {" "}
                          回复{" "}
                          {comment.replyTo.author ? (
                            <ForumAuthorName author={comment.replyTo.author} />
                          ) : (
                            "一条已不可用的回复"
                          )}
                        </>
                      ) : null}
                      ：
                      <ForumBody
                        body={comment.body!}
                        emojis={commentEmojis}
                        inline
                      />
                    </>
                  ) : (
                    <span className="text-muted">
                      {comment.state === "deleted"
                        ? "该回复已删除。"
                        : comment.state === "hidden"
                          ? "该回复已由管理员隐藏。"
                          : "内容不可用。"}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="mr-auto text-xs text-muted">
                    <Timestamp value={comment.createdAt} />
                    {comment.editedAt ? " · 已编辑" : ""}
                  </span>
                  {comment.capabilities.reply ? (
                    <Button
                      className="min-h-10 px-2"
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => onReply(post, comment)}
                    >
                      回复
                    </Button>
                  ) : null}
                  <ForumMenu items={menu(comment)} />
                </div>
              </article>
            ))}
            {post.comments.total > 5 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-expanded={expanded}
                aria-controls={`floor-comments-${post.id}`}
                disabled={loading}
                onClick={() => {
                  if (expanded) {
                    setExpanded(false);
                    const p = new URLSearchParams(location.search);
                    if (p.get("floor") === String(post.postNumber)) {
                      p.delete("floor");
                      p.delete("commentPage");
                      p.delete("comment");
                      onLocationChange(
                        location.pathname + (p.size ? `?${p}` : ""),
                        true,
                      );
                    }
                  } else void load(comments.page);
                }}
              >
                {loading
                  ? "正在加载…"
                  : expanded
                    ? "收起回复"
                    : `查看全部 ${post.comments.total} 条回复`}
              </Button>
            ) : null}
            {expanded && comments.total > comments.pageSize ? (
              <nav
                aria-label={`#${post.postNumber}楼中楼分页`}
                className="my-2 flex items-center gap-2"
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || comments.page <= 1}
                  onClick={() => void load(comments.page - 1)}
                >
                  上一页
                </Button>
                <span className="text-xs">
                  {comments.page} / {Math.ceil(comments.total / comments.pageSize)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    loading ||
                    comments.page >= Math.ceil(comments.total / comments.pageSize)
                  }
                  onClick={() => void load(comments.page + 1)}
                >
                  下一页
                </Button>
              </nav>
            ) : null}
            {editor}
          </section>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
            <Button
              type="button"
              variant="ghost"
              onClick={() => void load(comments.page)}
            >
              重试
            </Button>
          </p>
        ) : null}
      </div>
    </article>
  );
}
