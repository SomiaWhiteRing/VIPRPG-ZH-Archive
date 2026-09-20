import { Timestamp } from "@/app/components/ui/timestamp";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { NestedReply, nestedRepliesClassName } from "./nested-reply";
import { CommentReplyEditor } from "./reply-editor";
import { BodyEditor, type BodyEditorHandle } from "./body-editor";
import { EmojiPicker } from "@/app/components/emojis/picker";
import { FaceEmojiView } from "@/app/components/emojis/face-emoji";
import type { DraftImage } from "@/app/discussions/images";

import type { CommentTarget } from "@/app/.server/db/work-community";
import { Button } from "@/app/components/ui/button";
import { Notice } from "@/app/components/ui/notice";
import { useToast } from "@/app/components/ui/toast";
import { EmptyState } from "@/app/components/ui/empty-state";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { COMMENT_REPLY_PREVIEW_SIZE } from "@/lib/comment-pagination";
import type {
  CommentBodySegment,
  CommentDto,
  CommentPage,
  CommentReplyPage,
  FaceEmoji,
} from "@/lib/dto/db/work-community";
import { MessageCircle, Send, ThumbsUp, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

const NO_IMAGES: DraftImage[] = [];

type Props = {
  target: CommentTarget;
  placeholder?: string;
  canPin?: boolean;
  currentUserId: number | null;
  initialComments: CommentDto[];
  initialNextCursor: string | null;
};

export function CommentPanel(props: Props) {
  return (
    <CommentPanelContent
      key={`${props.target.kind}:${props.target.id}:${props.currentUserId}`}
      {...props}
    />
  );
}

function CommentPanelContent({
  target,
  canPin = false,
  placeholder = "写下你的游玩感受、攻略提示或考证……",
  currentUserId,
  initialComments,
  initialNextCursor,
}: Props) {
  const endpoint = commentEndpoint(target);
  const [comments, setComments] = useState(initialComments);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [newReplies, setNewReplies] = useState<Record<number, CommentDto>>({});
  const [commentUpdates, setCommentUpdates] = useState<
    Record<number, Partial<CommentDto>>
  >({});
  const pendingLikes = useRef(new Set<number>());
  const textareaRef = useRef<BodyEditorHandle>(null);

  async function submitComment() {
    if (!currentUserId || !body.trim() || busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body,
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        comment?: CommentDto;
        detail?: string;
      };
      if (!response.ok || !result.ok || !result.comment) {
        setSubmitError(result.detail ?? "评论发送失败。");
        return;
      }
      setBody("");
      setComments((current) =>
        target.kind === "work"
          ? [result.comment!, ...current]
          : [...current, result.comment!],
      );
      toast.success("评论已发布。");
    } catch {
      setSubmitError("网络请求失败，评论内容已保留，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike(comment: CommentDto) {
    if (
      !currentUserId ||
      busy ||
      comment.status !== "published" ||
      pendingLikes.current.has(comment.id)
    )
      return;
    pendingLikes.current.add(comment.id);
    const nextLiked = !comment.likedByMe;
    setCommentUpdates((current) => ({
      ...current,
      [comment.id]: {
        ...current[comment.id],
        likedByMe: nextLiked,
        likeCount: Math.max(0, comment.likeCount + (nextLiked ? 1 : -1)),
      },
    }));
    try {
      const response = await fetch(`/api/comments/${comment.id}/like`, {
        method: nextLiked ? "PUT" : "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
    } catch {
      setCommentUpdates((current) => ({
        ...current,
        [comment.id]: {
          ...current[comment.id],
          likedByMe: comment.likedByMe,
          likeCount: comment.likeCount,
        },
      }));
      toast.error("点赞操作失败。");
    } finally {
      pendingLikes.current.delete(comment.id);
    }
  }

  async function removeComment(comment: CommentDto): Promise<boolean> {
    if (
      !currentUserId ||
      comment.author?.id !== currentUserId ||
      !window.confirm("确定删除这条评论吗？")
    )
      return false;
    try {
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
      if (comment.rootCommentId) {
        setCommentUpdates((current) => ({
          ...current,
          [comment.id]: {
            ...current[comment.id],
            status: "deleted",
            body: [{ type: "text", text: "该评论已删除" }],
            bodySource: null,
          },
        }));
      } else {
        setComments((current) =>
          current.filter((entry) => entry.id !== comment.id),
        );
      }
      return true;
    } catch {
      toast.error("评论删除失败。");
      return false;
    }
  }

  async function togglePin(comment: CommentDto) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: "PATCH", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: !comment.pinned }),
      });
      if (!response.ok) throw new Error();
      const refreshed = await fetch(endpoint, { credentials: "same-origin" });
      const result = await refreshed.json() as CommentPage & { ok?: boolean };
      if (!refreshed.ok || !result.ok) throw new Error();
      setComments(result.items);
      setNextCursor(result.nextCursor);
      toast.success(comment.pinned ? "已取消置顶。" : "评论已置顶。");
    } catch {
      toast.error("置顶操作或列表刷新失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!nextCursor || busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${endpoint}?cursor=${encodeURIComponent(nextCursor)}`,
        { credentials: "same-origin" },
      );
      const result = (await response.json()) as {
        ok?: boolean;
        items?: CommentDto[];
        nextCursor?: string | null;
      };
      if (!response.ok || !result.ok) throw new Error();
      setComments((current) => {
        const byId = new Map(current.map((comment) => [comment.id, comment]));
        for (const comment of result.items ?? []) byId.set(comment.id, comment);
        return [...byId.values()].sort((a, b) => {
          const order = a.createdAt.localeCompare(b.createdAt) || a.id - b.id;
          return target.kind === "work" ? -order : order;
        });
      });
      setNextCursor(result.nextCursor ?? null);
    } catch {
      toast.error("评论加载失败。");
    } finally {
      setBusy(false);
    }
  }

  function replyCreated(rootId: number, reply: CommentDto) {
    setComments((current) => current.map((comment) =>
      comment.id === rootId
        ? { ...comment, replyCount: (comment.replyCount ?? 0) + 1 }
        : comment,
    ));
    setNewReplies((current) => ({ ...current, [rootId]: reply }));
  }

  function insertEmoji(emoji: FaceEmoji, options: { focus: boolean }) {
    textareaRef.current?.insertEmoji(emoji, options);
  }

  return (
    <div className="@container/comments grid gap-4" id="comments">
      {currentUserId ? (
        <div className="grid gap-2">
          <BodyEditor
            textOnly
            maxLength={2000}
            inputId="comment-input"
            body={body}
            images={NO_IMAGES}
            busy={busy}
            topic={false}
            placeholder={placeholder}
            ref={textareaRef}
            onChange={setBody}
            onBusyChange={setBusy}
            onError={setSubmitError}
            onCompositionChange={() => {}}
          />
          <EmojiPicker
            disabled={busy}
            onSelect={insertEmoji}
            onClose={() => textareaRef.current?.focus()}
          >
            {(trigger) => (
              <div className="flex items-center justify-between gap-3">
                {trigger}
                <Button
                  disabled={busy || !body.trim()}
                  onClick={() => void submitComment()}
                  type="button"
                >
                  <Send aria-hidden />
                  发布评论
                </Button>
              </div>
            )}
          </EmojiPicker>
          {submitError ? <Notice>{submitError}</Notice> : null}
        </div>
      ) : (
        <p className="text-sm text-muted">登录后可以评论、回复和点赞。</p>
      )}

      <div className="grid">
        {comments.length ? (
          comments.map((comment) => (
            <CommentCard
              comment={comment}
              pinControl={canPin ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void togglePin(comment)}>{comment.pinned ? "取消置顶" : "置顶"}</Button> : null}
              commentUpdates={commentUpdates}
              currentUserId={currentUserId}
              newReply={newReplies[comment.id] ?? null}
              key={comment.id}
              onDelete={removeComment}
              onLike={toggleLike}
              endpoint={endpoint}
              onReplyCreated={replyCreated}
            />
          ))
        ) : (
          <EmptyState title="还没有评论。" variant="plain" />
        )}
      </div>
      {nextCursor ? (
        <div>
          <Button
            disabled={busy}
            onClick={() => void loadMore()}
            type="button"
            variant="outline"
          >
            加载更多评论
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function commentEndpoint(target: CommentTarget): string {
  const paths = { work: "works", creator: "creators", character: "characters" };
  return `/api/${paths[target.kind]}/${target.id}/comments`;
}

function CommentCard({
  comment,
  pinControl,
  commentUpdates,
  currentUserId,
  newReply,
  endpoint,
  onReplyCreated,
  onLike,
  onDelete,
}: {
  comment: CommentDto;
  pinControl: React.ReactNode;
  commentUpdates: Record<number, Partial<CommentDto>>;
  currentUserId: number | null;
  newReply: CommentDto | null;
  endpoint: string;
  onReplyCreated: (rootId: number, reply: CommentDto) => void;
  onLike: (comment: CommentDto) => void;
  onDelete: (comment: CommentDto) => Promise<boolean>;
}) {
  const [replyTarget, setReplyTarget] = useState<CommentDto | null>(null);
  const [replyBusy, setReplyBusy] = useState(false);
  function startReply(target: CommentDto) {
    if (!replyBusy) setReplyTarget(target);
  }
  const [replies, setReplies] = useState<CommentReplyPage | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedReplyId, setFocusedReplyId] = useState<number | null>(null);
  const requestId = useRef(0);
  const lastRequest = useRef<{ page: number; commentId?: number }>({ page: 1 });

  const loadReplies = useCallback(
    async (page: number, commentId?: number) => {
      const id = ++requestId.current;
      lastRequest.current = { page, commentId };
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page) });
        if (commentId) params.set("comment", String(commentId));
        const response = await fetch(
          `/api/comments/${comment.id}/replies?${params}`,
          { credentials: "same-origin" },
        );
        const result = (await response.json()) as CommentReplyPage & {
          ok?: boolean;
        };
        if (!response.ok || !result.ok) throw new Error();
        if (requestId.current !== id) return;
        setReplies(result);
        setExpanded(true);
        setFocusedReplyId(commentId ?? null);
      } catch {
        if (requestId.current === id) setError("回复加载失败，请重试。");
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    },
    [comment.id],
  );

  useEffect(() => {
    if (newReply) void loadReplies(1, newReply.id);
    return () => {
      requestId.current += 1;
    };
  }, [newReply, loadReplies]);

  useEffect(() => {
    if (focusedReplyId)
      document.getElementById(`comment-${focusedReplyId}`)?.focus();
  }, [focusedReplyId, replies]);

  const preview = replies?.preview ?? comment.replyPreview ?? [];
  const visibleReplies = expanded && replies ? replies.items : preview;
  const replyCount = replies?.total ?? comment.replyCount ?? 0;
  const currentComment = { ...comment, ...commentUpdates[comment.id] };

  return (
    <article
      className="grid grid-cols-[38px_minmax(0,1fr)] gap-3 border-t border-border py-3 first:border-t-0 first:pt-0 @max-[320px]/comments:grid-cols-[32px_minmax(0,1fr)] @max-[320px]/comments:gap-2"
      id={`comment-${comment.id}`}
    >
      {comment.author ? (
        <Link
          aria-label={`查看${comment.author.displayName}的主页`}
          to={`/users/${comment.author.id}`}
        >
          <UserAvatar
            avatarBlobSha256={comment.author.avatarBlobSha256}
            className="size-9.5"
            displayName={comment.author.displayName}
            size={38}
          />
        </Link>
      ) : (
        <UserAvatar
          className="size-9.5 opacity-60"
          displayName="已删除用户"
          size={38}
        />
      )}
      <div className="min-w-0">
        {currentComment.pinned ? <span className="text-xs font-bold text-primary">置顶</span> : null}
        <CommentLine comment={currentComment} />
        <div className="flex flex-wrap items-center gap-1">
          <CommentControls
            comment={currentComment}
            currentUserId={currentUserId}
            onDelete={onDelete}
            onLike={onLike}
            onReply={startReply}
          />
          {pinControl}
        </div>
        {replyCount > 0 || loading || error || replyTarget ? (
          <section
            aria-label={`${comment.floorNumber} 楼的回复`}
            aria-busy={loading}
            className={nestedRepliesClassName}
            id={`comment-replies-${comment.id}`}
          >
            {visibleReplies.map((entry) => {
              const reply = { ...entry, ...commentUpdates[entry.id] };
              if (reply.status === "deleted") return null;
              return (
                <CommentNestedReply
                  key={reply.id}
                  comment={reply}
                  currentUserId={currentUserId}
                  onDelete={async (reply) => {
                    if (await onDelete(reply)) {
                      if (replyTarget?.id === reply.id) setReplyTarget(null);
                      await loadReplies(replies?.page ?? 1);
                    }
                  }}
                  onLike={onLike}
                  onReply={startReply}
                />
              );
            })}
            {replyCount > COMMENT_REPLY_PREVIEW_SIZE ? (
              <Button
                aria-controls={`comment-replies-${comment.id}`}
                aria-expanded={expanded}
                disabled={loading}
                onClick={() => {
                  if (expanded) {
                    setExpanded(false);
                    setFocusedReplyId(null);
                    setError(null);
                  } else void loadReplies(replies?.page ?? 1);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {loading
                  ? "正在加载…"
                  : expanded
                    ? "收起回复"
                    : `查看全部 ${replyCount} 条回复`}
              </Button>
            ) : null}
            {expanded && replies && replies.total > replies.pageSize ? (
              <PaginationLinks
                ariaLabel={`${comment.floorNumber} 楼的回复分页`}
                className="my-2"
                page={replies.page}
                pageSize={replies.pageSize}
                total={replies.total}
                disabled={loading}
                onPageChange={(page) => void loadReplies(page)}
              />
            ) : null}
            {error ? (
              <div
                className="flex flex-wrap items-center gap-2 text-sm text-muted"
                role="status"
              >
                {error}
                <Button
                  disabled={loading}
                  onClick={() =>
                    void loadReplies(
                      lastRequest.current.page,
                      lastRequest.current.commentId,
                    )
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  重试
                </Button>
              </div>
            ) : null}
            {replyTarget && currentUserId ? (
              <CommentReplyEditor
                endpoint={endpoint}
                rootId={comment.id}
                target={replyTarget}
                unavailable={
                  commentUpdates[replyTarget.id]?.status === "deleted"
                }
                onBusyChange={setReplyBusy}
                onCancel={() => setReplyTarget(null)}
                onCreated={(reply) => {
                  onReplyCreated(comment.id, reply);
                  setReplyTarget(null);
                }}
              />
            ) : null}
          </section>
        ) : null}
      </div>
    </article>
  );
}

function CommentNestedReply({
  comment,
  currentUserId,
  onReply,
  onLike,
  onDelete,
}: {
  comment: CommentDto;
  currentUserId: number | null;
  onReply: (comment: CommentDto) => void;
  onLike: (comment: CommentDto) => void;
  onDelete: (comment: CommentDto) => void;
}) {
  if (comment.status === "deleted") return null;
  return (
    <NestedReply
      id={`comment-${comment.id}`}
      metadata={<>
        <Timestamp value={comment.createdAt} />
        {comment.editedAt ? " · 已编辑" : ""}
      </>}
      actions={<>
        {currentUserId ? (
          <Button className="min-h-10 px-2" size="sm" variant="ghost" type="button" onClick={() => onReply(comment)}>
            回复
          </Button>
        ) : null}
        <Button
          className="min-h-10 px-2 disabled:opacity-100"
          size="sm" variant="ghost" type="button"
          disabled={!currentUserId}
          aria-pressed={comment.likedByMe}
          aria-label={`${comment.likedByMe ? "取消赞" : "赞"}，${comment.likeCount} 个赞`}
          onClick={() => onLike(comment)}
        >
          <ThumbsUp aria-hidden className={comment.likedByMe ? "text-primary" : undefined} />
          <span className={comment.likedByMe ? "text-primary" : undefined}>{comment.likeCount}</span>
        </Button>
        {currentUserId === comment.author?.id ? (
          <Button className="min-h-10 px-2" size="sm" variant="ghost" type="button" onClick={() => onDelete(comment)}>
            删除
          </Button>
        ) : null}
      </>}
    >
      {comment.author ? (
          <Link className="break-all text-primary hover:underline" to={`/users/${comment.author.id}`}>
            {comment.author.displayName}
          </Link>
        ) : "已删除用户"}
        {comment.replyTo ? <span className="text-muted"> 回复 {comment.replyTo.displayName ?? "已删除用户"}</span> : null}
        ：<span className="whitespace-pre-wrap"><CommentBody body={comment.body} /></span>
    </NestedReply>
  );
}

function CommentLine({ comment }: { comment: CommentDto }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {comment.author ? (
          <Link
            className="text-sm font-bold hover:underline"
            to={`/users/${comment.author.id}`}
          >
            {comment.author.displayName}
          </Link>
        ) : (
          <strong className="text-sm">已删除用户</strong>
        )}
        <span className="font-mono text-xs text-muted">
          <Timestamp value={comment.createdAt} />
        </span>
        {comment.editedAt ? (
          <span className="font-mono text-xs text-muted">已编辑</span>
        ) : null}
        {comment.status === "deleted" ? (
          <span className="font-mono text-xs text-muted">已删除</span>
        ) : null}
        <span className="ml-auto font-mono text-xs text-muted">
          {comment.floorNumber} 楼
        </span>
      </div>
      <p className="m-0 mt-1 text-[15px] leading-[1.7] wrap-anywhere whitespace-pre-wrap">
        {comment.replyTo ? (
          <span className="text-muted">
            回复 @{comment.replyTo.displayName ?? "已删除用户"}：
          </span>
        ) : null}
        <CommentBody body={comment.body} />
      </p>
    </div>
  );
}

function CommentBody({ body }: { body: CommentBodySegment[] }) {
  return body.map((segment, index) =>
    segment.type === "text" ? (
      <span key={index}>{segment.text}</span>
    ) : (
      <FaceEmojiView emoji={segment.emoji} key={index} />
    ),
  );
}

function CommentControls({
  comment,
  currentUserId,
  onReply,
  onLike,
  onDelete,
}: {
  comment: CommentDto;
  currentUserId: number | null;
  onReply: (comment: CommentDto) => void;
  onLike: (comment: CommentDto) => void;
  onDelete: (comment: CommentDto) => void;
}) {
  if (comment.status === "deleted") return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {currentUserId ? (
        <Button
          className="text-xs text-muted"
          onClick={() => onReply(comment)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <MessageCircle aria-hidden />
          回复
        </Button>
      ) : null}
      <Button
        aria-label={
          comment.likedByMe
            ? `取消赞，${comment.likeCount} 个赞`
            : `赞，${comment.likeCount} 个赞`
        }
        aria-pressed={comment.likedByMe}
        className="text-xs text-muted disabled:opacity-100"
        disabled={!currentUserId}
        onClick={() => onLike(comment)}
        size="sm"
        type="button"
        variant={comment.likedByMe ? "outline" : "ghost"}
      >
        <ThumbsUp aria-hidden />
        {comment.likeCount}
      </Button>
      {currentUserId === comment.author?.id ? (
        <Button
          className="text-xs text-muted"
          onClick={() => onDelete(comment)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Trash2 aria-hidden />
          删除
        </Button>
      ) : null}
    </div>
  );
}
