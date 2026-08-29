"use client";

import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import type { CommentBodySegment, CommentDto, CustomEmojiDto } from "@/lib/server/db/work-community";
import { Heart, MessageCircle, Send, Smile, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const AVATAR_TONES = ["bg-[#3d6fb4]", "bg-[#3f8f6a]", "bg-[#c0584f]", "bg-[#7d5ba6]"];

type Props = {
  workId: number;
  currentUserId: number | null;
  initialComments: CommentDto[];
  initialNextCursor: string | null;
  emojis: CustomEmojiDto[];
};

export function WorkCommunityPanel({
  workId,
  currentUserId,
  initialComments,
  initialNextCursor,
  emojis,
}: Props) {
  const [comments, setComments] = useState(initialComments);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [body, setBody] = useState("");
  const [replyTarget, setReplyTarget] = useState<CommentDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void fetch(`/api/works/${workId}/view`, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  }, [workId]);

  async function submitComment() {
    if (!currentUserId || !body.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/works/${workId}/comments`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body,
          ...(replyTarget ? { replyToCommentId: replyTarget.id } : {}),
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        comment?: CommentDto;
        detail?: string;
      };
      if (!response.ok || !result.ok || !result.comment) {
        setMessage(result.detail ?? "评论发送失败。");
        return;
      }
      setBody("");
      if (replyTarget) {
        setComments((current) => current.map((comment) =>
          comment.id === (replyTarget.rootCommentId ?? replyTarget.id)
            ? { ...comment, replyCount: (comment.replyCount ?? 0) + 1 }
            : comment,
        ));
      } else {
        setComments((current) => [...current, result.comment!]);
      }
      setReplyTarget(null);
      setMessage("评论已发布。");
    } catch {
      setMessage("网络请求失败。");
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike(comment: CommentDto) {
    if (!currentUserId || busy || comment.status !== "published") return;
    const nextLiked = !comment.likedByMe;
    setComments((current) => current.map((entry) => entry.id === comment.id
      ? {
          ...entry,
          likedByMe: nextLiked,
          likeCount: Math.max(0, entry.likeCount + (nextLiked ? 1 : -1)),
        }
      : entry,
    ));
    try {
      const response = await fetch(`/api/comments/${comment.id}/like`, {
        method: nextLiked ? "PUT" : "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
    } catch {
      setComments((current) => current.map((entry) => entry.id === comment.id
        ? { ...entry, likedByMe: comment.likedByMe, likeCount: comment.likeCount }
        : entry,
      ));
      setMessage("点赞操作失败。");
    }
  }

  async function removeComment(comment: CommentDto) {
    if (
      !currentUserId ||
      comment.author?.id !== currentUserId ||
      !window.confirm("确定删除这条评论吗？")
    ) return;
    try {
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
      setComments((current) => current.filter((entry) => entry.id !== comment.id));
    } catch {
      setMessage("评论删除失败。");
    }
  }

  async function loadMore() {
    if (!nextCursor || busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/works/${workId}/comments?cursor=${encodeURIComponent(nextCursor)}`,
        { credentials: "same-origin" },
      );
      const result = (await response.json()) as {
        ok?: boolean;
        items?: CommentDto[];
        nextCursor?: string | null;
      };
      if (!response.ok || !result.ok) throw new Error();
      setComments((current) => [...current, ...(result.items ?? [])]);
      setNextCursor(result.nextCursor ?? null);
    } catch {
      setMessage("评论加载失败。");
    } finally {
      setBusy(false);
    }
  }

  function startReply(comment: CommentDto) {
    setReplyTarget(comment);
    textareaRef.current?.focus();
  }

  function insertEmoji(shortcode: string) {
    const textarea = textareaRef.current;
    const token = `:${shortcode}:`;
    if (!textarea) {
      setBody((current) => current + token);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setBody((current) => `${current.slice(0, start)}${token}${current.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div className="grid gap-4" id="comments">
      {currentUserId ? (
        <div className="grid gap-2">
          {replyTarget ? (
            <div className="flex items-center justify-between gap-2 text-sm text-muted">
              <span>回复 @{replyTarget.author?.displayName ?? "已删除用户"}</span>
              <Button onClick={() => setReplyTarget(null)} size="sm" type="button" variant="ghost">
                取消
              </Button>
            </div>
          ) : null}
          <Label className="font-mono text-[11px] text-muted" htmlFor="comment-input">
            发表评论
          </Label>
          <Textarea
            id="comment-input"
            maxLength={2000}
            onChange={(event) => setBody(event.target.value)}
            placeholder="写下你的游玩感受、攻略提示或考证……"
            ref={textareaRef}
            rows={4}
            value={body}
          />
          <div className="flex items-center justify-between gap-3">
            <EmojiPicker emojis={emojis} onSelect={insertEmoji} />
            <Button disabled={busy || !body.trim()} onClick={() => void submitComment()} type="button">
              <Send aria-hidden />
              发布评论
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-muted">登录后可以评论、回复和点赞。</p>
      )}

      <div className="grid">
        {comments.length ? comments.map((comment) => (
          <CommentCard
            comment={comment}
            currentUserId={currentUserId}
            key={comment.id}
            onDelete={removeComment}
            onLike={toggleLike}
            onReply={startReply}
          />
        )) : <p className="text-[13px] text-muted">还没有评论。</p>}
      </div>
      {nextCursor ? (
        <div>
          <Button disabled={busy} onClick={() => void loadMore()} type="button" variant="outline">
            加载更多评论
          </Button>
        </div>
      ) : null}
      {message ? <p className="text-[13px] text-muted" role="status">{message}</p> : null}
    </div>
  );
}

function CommentCard({
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
  const [replies, setReplies] = useState<CommentDto[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadReplies() {
    if (replies || loading) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/comments/${comment.id}/replies`, {
        credentials: "same-origin",
      });
      const result = (await response.json()) as { ok?: boolean; items?: CommentDto[] };
      if (!response.ok || !result.ok) throw new Error();
      setReplies(result.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <article
      className="grid grid-cols-[38px_minmax(0,1fr)] gap-3 border-t border-border py-3 first:border-t-0 first:pt-0"
      id={`comment-${comment.id}`}
    >
      <span
        className={`grid size-9.5 place-items-center rounded-lg font-serif text-base font-bold text-white [text-shadow:0_1px_0_rgb(0_0_0/30%)] ${avatarTone(comment.id)}`}
        aria-hidden="true"
      >
        {comment.author?.displayName?.slice(0, 1) ?? "删"}
      </span>
      <div className="min-w-0">
        <CommentLine comment={comment} />
        <CommentControls
          comment={comment}
          currentUserId={currentUserId}
          onDelete={onDelete}
          onLike={onLike}
          onReply={onReply}
        />
        {(comment.replyCount ?? 0) > 0 ? (
          <div className="mt-2.5 grid gap-2.5 border-l-2 border-border pl-3">
            {replies?.map((reply) => (
              <div className="min-w-0" id={`comment-${reply.id}`} key={reply.id}>
                <CommentLine comment={reply} />
                <CommentControls
                  comment={reply}
                  currentUserId={currentUserId}
                  onDelete={onDelete}
                  onLike={onLike}
                  onReply={onReply}
                />
              </div>
            ))}
            {!replies ? (
              <Button disabled={loading} onClick={() => void loadReplies()} size="sm" type="button" variant="ghost">
                {loading ? "加载中" : `查看 ${comment.replyCount} 条回复`}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function CommentLine({ comment }: { comment: CommentDto }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <strong className="text-sm">{comment.author?.displayName ?? "已删除用户"}</strong>
        <span className="font-mono text-[11px] text-muted">{new Date(comment.createdAt).toLocaleString("zh-CN")}</span>
        {comment.editedAt ? <span className="font-mono text-[11px] text-muted">已编辑</span> : null}
        {comment.status === "deleted" ? <span className="font-mono text-[11px] text-muted">已删除</span> : null}
        <span className="ml-auto font-mono text-[11px] text-muted">#{comment.id}</span>
      </div>
      <p className="m-0 mt-1 text-sm leading-[1.7] wrap-anywhere whitespace-pre-wrap">
        {comment.replyTo ? <span className="text-muted">回复 @{comment.replyTo.displayName ?? "已删除用户"}：</span> : null}
        <CommentBody body={comment.body} />
      </p>
    </div>
  );
}

function CommentBody({ body }: { body: CommentBodySegment[] }) {
  return body.map((segment, index) => segment.type === "text"
    ? <span key={index}>{segment.text}</span>
    : <Image
        alt={segment.alt}
        className="mx-0.5 inline-block h-6 w-6 align-text-bottom"
        height={24}
        key={`${segment.shortcode}-${index}`}
        src={segment.imageUrl}
        unoptimized
        width={24}
      />);
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
        <Button className="text-xs text-muted" onClick={() => onReply(comment)} size="sm" type="button" variant="ghost">
          <MessageCircle aria-hidden />
          回复
        </Button>
      ) : null}
      {currentUserId ? (
        <Button
          aria-pressed={comment.likedByMe}
          className="text-xs text-muted"
          onClick={() => onLike(comment)}
          size="sm"
          type="button"
          variant={comment.likedByMe ? "outline" : "ghost"}
        >
          <Heart aria-hidden />
          {comment.likeCount}
        </Button>
      ) : (
        <span className="px-2 text-xs text-muted">{comment.likeCount} 赞</span>
      )}
      {currentUserId === comment.author?.id ? (
        <Button className="text-xs text-muted" onClick={() => onDelete(comment)} size="sm" type="button" variant="ghost">
          <Trash2 aria-hidden />
          删除
        </Button>
      ) : null}
    </div>
  );
}

function EmojiPicker({ emojis, onSelect }: { emojis: CustomEmojiDto[]; onSelect: (shortcode: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button aria-expanded={open} onClick={() => setOpen((value) => !value)} size="sm" type="button" variant="ghost">
        <Smile aria-hidden />
        表情
      </Button>
      {open ? (
        <div className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-80 overflow-hidden rounded-md border border-border bg-card p-2 shadow-lg">
          <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto">
            {emojis.length ? emojis.map((emoji) => (
              <Button
                aria-label={`插入 :${emoji.shortcode}:`}
                className="grid h-9 w-9 p-0"
                key={emoji.shortcode}
                onClick={() => { onSelect(emoji.shortcode); setOpen(false); }}
                title={`:${emoji.shortcode}:`}
                type="button"
                variant="ghost"
              >
                <Image alt={emoji.name} height={24} src={emoji.imageUrl} unoptimized width={24} />
              </Button>
            )) : <span className="col-span-6 p-2 text-sm text-muted">暂无站点表情。</span>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function avatarTone(id: number): string {
  return AVATAR_TONES[Math.abs(id) % AVATAR_TONES.length];
}
