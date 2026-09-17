import { PaginationLinks } from "@/app/components/library/pagination-links";
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
import type { CustomEmojiDto } from "@/lib/dto/db/work-community";
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
import { MessageSquare, ThumbsUp } from "lucide-react";
import {
  Fragment,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { Link, useNavigate, useRevalidator } from "react-router";
import type { ForumDialogAction, ForumMenuItem } from "./actions";
import { ForumActionDialog, ForumMenu } from "./actions";
import type { ForumDraft } from "./draft";
import {
  ForumReplyBar,
  draftSnapshot,
  draftValue,
  forumReplyLauncherClass,
} from "./draft";
import { ForumImages, existingDraftImages, uploadDraftImages } from "./images";
import {
  ForumAuthorName,
  ForumBody,
  ForumRequestError,
  ForumTime,
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
  emojis: CustomEmojiDto[];
  initialDetail?: ForumDetail;
  topics?: ForumPage<ForumTopic>;
  selected?: ForumTag[];
  popular?: ForumTag[];
  featured?: boolean;
  filterError?: string;
  returnTo?: string;
  initialReply?: "topic" | number;
};
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
    [message, setMessage] = useState(""),
    [requestError, setRequestError] = useState<ForumRequestError | null>(null);
  const [action, setAction] = useState<ForumDialogAction | null>(null),
    [confirm, setConfirm] = useState<{
      resolve: (value: boolean) => void;
    } | null>(null),
    [unavailable, setUnavailable] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setDetail(initialDetail);
    setUnavailable(false);
  }, [initialDetail]);
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
    if (!detail) return;
    const targetId = detail.comment
      ? `comment-${detail.comment}`
      : detail.floor
        ? `post-${detail.floor}`
        : location.hash.slice(1);
    const replyEditor = initialReply
      ? document.querySelector<HTMLElement>(
          '[data-forum-editor] textarea, [data-forum-editor] [contenteditable="true"]',
        )
      : null;
    const element =
      replyEditor ??
      (targetId
        ? document.getElementById(targetId)
        : document.querySelector<HTMLElement>("[data-forum-post]"));
    if (element) {
      element.focus({ preventScroll: true });
      if (targetId || replyEditor)
        element.scrollIntoView({
          block: "center",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
    }
    if (initialReply) {
      const url = new URL(location.href);
      url.searchParams.delete("reply");
      void navigateAccepted(url.pathname + url.search + url.hash, {
        replace: true,
        preventScrollReset: true,
      });
    }
  }, [detail, initialReply, navigateAccepted]);
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
        await navigateAccepted(
          location.pathname + (params.size ? `?${params}` : ""),
          { replace: true, preventScrollReset: true },
        );
      }
      const result = await forumRequest<{
        detail: ForumDetail;
        emojis: CustomEmojiDto[];
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
      setCurrentEmojis(result.emojis);
      setDetail(result.detail);
    } catch (e) {
      if (e instanceof ForumRequestError && e.status === 404)
        setUnavailable(true);
      else setMessage(e instanceof Error ? e.message : "加载失败。");
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
      setMessage(e instanceof Error ? e.message : "读取失败。");
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
      setMessage("已保存。");
      const destination = new URL(result.href, location.origin);
      if (listReturn && listReturn !== "/discussions")
        destination.searchParams.set("from", listReturn);
      if (detail?.topic.id === result.topicId) {
        await navigateAccepted(
          destination.pathname + destination.search + destination.hash,
          { preventScrollReset: true },
        );
        await refreshDetail();
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
                    .catch((e) => setMessage(e.message));
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
  const editor = draft ? (
    <ClientOnly>
      <ForumEditor
        key={draft.editorId}
        draft={draft}
        viewer={viewer}
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
      draft?.mode === "post" ? (
        editor
      ) : (
        <ForumReplyBar viewer={viewer}>
          {detail.topic.locked ? (
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
      )
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
                <ForumTime value={detail.topic.createdAt} />
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
                  onLocationChange={(href, replace) => {
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
                      {item.tags.length > 0 || item.featured || item.locked ? (
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
                          <ForumTime value={item.activeAt} relative />
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
                      <ForumTime value={item.activeAt} relative />
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
      <p role="status" className="my-3 text-sm">
        {pending ? "正在更新讨论…" : message}
      </p>
      {draft?.mode === "topic" ? editor : null}
      {action ? (
        <ForumActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={() => {
            setMessage(
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
  emojis: CustomEmojiDto[];
  initialExpanded: boolean;
  menu: (content: ForumContent) => ForumMenuItem[];
  onReply: (parent: ForumContent, reply?: ForumContent) => void;
  editor: React.ReactNode;
  onLocationChange: (href: string, replace?: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(initialExpanded),
    [commentEmojis, setCommentEmojis] = useState(emojis),
    [comments, setComments] = useState(post.comments),
    [preview, setPreview] = useState(post.commentPreview),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [liked, setLiked] = useState(post.liked),
    [likes, setLikes] = useState(post.likes),
    [liking, setLiking] = useState(false);
  useEffect(() => {
    setComments(post.comments);
    setPreview(post.commentPreview);
    setLiked(post.liked);
    setLikes(post.likes);
    setCommentEmojis(emojis);
    if (initialExpanded) setExpanded(true);
  }, [post, emojis, initialExpanded]);
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
      onLocationChange(`${location.pathname}?${params}`);
      setTimeout(
        () =>
          document
            .getElementById(`comment-${result.comments.items[0]?.id}`)
            ?.focus({ preventScroll: true }),
        0,
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
      setError(e instanceof Error ? e.message : "点赞失败。");
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
            <ForumTime value={post.createdAt} />
            {post.editedAt ? " · 已编辑" : ""}
          </span>
          <div className="ml-auto flex items-center gap-0">
            {post.capabilities.like ? (
              <Button
                className="min-h-10 px-2"
                size="sm"
                variant="ghost"
                type="button"
                disabled={liking}
                aria-label={
                  liked ? `取消赞，${likes} 个赞` : `赞，${likes} 个赞`
                }
                aria-pressed={liked}
                onClick={() => void toggleLike()}
              >
                <ThumbsUp
                  className={liked ? "size-4 text-primary" : "size-4"}
                />
                <span className={liked ? "text-primary" : undefined}>
                  {likes || "赞"}
                </span>
              </Button>
            ) : post.body !== null ? (
              <span className="p-2 text-xs text-muted">{likes} 赞</span>
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
            className="mt-3 border-l-2 border-border bg-muted/10 p-2 sm:p-3"
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
                    <ForumTime value={comment.createdAt} />
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
