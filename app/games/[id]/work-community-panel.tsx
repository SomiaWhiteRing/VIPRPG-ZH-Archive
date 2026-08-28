"use client";

import { Button } from "@/app/components/ui/button";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import type { CatalogSummary } from "@/lib/server/db/catalogs";
import type { CommentBodySegment, CommentDto, CustomEmojiDto } from "@/lib/server/db/work-community";
import { Heart, MessageCircle, Send, Smile, Trash2 } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type Props = {
  workId: number;
  currentUserId: number | null;
  initialWishlisted: boolean;
  initialComments: CommentDto[];
  initialNextCursor: string | null;
  emojis: CustomEmojiDto[];
  stats: { viewCount: number; playerCount: number; commentCount: number };
  catalogs: CatalogSummary[];
};

export function WorkCommunityPanel({
  workId,
  currentUserId,
  initialWishlisted,
  initialComments,
  initialNextCursor,
  emojis,
  stats,
  catalogs,
}: Props) {
  const [comments, setComments] = useState(initialComments);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [wishlisted, setWishlisted] = useState(initialWishlisted);
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
        body: JSON.stringify({ body, ...(replyTarget ? { replyToCommentId: replyTarget.id } : {}) }),
      });
      const result = (await response.json()) as { ok?: boolean; comment?: CommentDto; detail?: string };
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

  async function toggleWishlist() {
    if (!currentUserId || busy) return;
    const next = !wishlisted;
    setBusy(true);
    try {
      const response = await fetch(`/api/works/${workId}/me`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wishlisted: next }),
      });
      if (!response.ok) throw new Error();
      setWishlisted(next);
    } catch {
      setMessage("待玩状态保存失败。");
    } finally {
      setBusy(false);
    }
  }

  async function toggleLike(comment: CommentDto) {
    if (!currentUserId || busy || comment.status !== "published") return;
    const nextLiked = !comment.likedByMe;
    setComments((current) => current.map((entry) => entry.id === comment.id
      ? { ...entry, likedByMe: nextLiked, likeCount: Math.max(0, entry.likeCount + (nextLiked ? 1 : -1)) }
      : entry));
    try {
      const response = await fetch(`/api/comments/${comment.id}/like`, {
        method: nextLiked ? "PUT" : "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
    } catch {
      setComments((current) => current.map((entry) => entry.id === comment.id
        ? { ...entry, likedByMe: comment.likedByMe, likeCount: comment.likeCount }
        : entry));
      setMessage("点赞操作失败。");
    }
  }

  async function removeComment(comment: CommentDto) {
    if (!currentUserId || comment.author?.id !== currentUserId || !window.confirm("确定删除这条评论吗？")) return;
    try {
      const response = await fetch(`/api/comments/${comment.id}`, { method: "DELETE", credentials: "same-origin" });
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
      const response = await fetch(`/api/works/${workId}/comments?cursor=${encodeURIComponent(nextCursor)}`, { credentials: "same-origin" });
      const result = (await response.json()) as { ok?: boolean; items?: CommentDto[]; nextCursor?: string | null };
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
    <section className="grid gap-5" id="comments">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          <span>{stats.viewCount.toLocaleString("zh-CN")} 浏览</span>
          <span>{stats.playerCount.toLocaleString("zh-CN")} 位玩家</span>
          <span>{stats.commentCount.toLocaleString("zh-CN")} 条评论</span>
        </div>
        {currentUserId ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={toggleWishlist} type="button" variant={wishlisted ? "default" : "outline"}>
              {wishlisted ? "已加入待玩" : "加入待玩"}
            </Button>
            <CatalogQuickAdd catalogs={catalogs} workId={workId} />
          </div>
        ) : null}
      </div>

      {currentUserId ? (
        <div className="grid gap-3 rounded-md border border-border bg-muted/10 p-4">
          {replyTarget ? (
            <div className="flex items-center justify-between gap-2 text-sm text-muted">
              <span>回复 @{replyTarget.author?.displayName ?? "已删除用户"}</span>
              <Button onClick={() => setReplyTarget(null)} size="sm" type="button" variant="ghost">取消</Button>
            </div>
          ) : null}
          <Textarea
            maxLength={2000}
            onChange={(event) => setBody(event.target.value)}
            placeholder="写下你的评论"
            ref={textareaRef}
            rows={4}
            value={body}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <EmojiPicker emojis={emojis} onSelect={insertEmoji} />
            <Button disabled={busy || !body.trim()} onClick={submitComment} type="button">
              <Send /> 发布评论
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">登录后可以评论、回复、点赞和加入待玩。</p>
      )}

      <div className="grid gap-4">
        {comments.length ? comments.map((comment) => (
          <CommentCard
            comment={comment}
            currentUserId={currentUserId}
            key={comment.id}
            onDelete={removeComment}
            onLike={toggleLike}
            onReply={startReply}
          />
        )) : <p className="text-sm text-muted">还没有评论。</p>}
      </div>
      {nextCursor ? <div><Button disabled={busy} onClick={loadMore} type="button" variant="outline">加载更多评论</Button></div> : null}
      {message ? <p className="text-sm text-muted" role="status">{message}</p> : null}
    </section>
  );
}

function CatalogQuickAdd({ catalogs, workId }: { catalogs: CatalogSummary[]; workId: number }) {
  const [catalogId, setCatalogId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function add() {
    if (!catalogId) return;
    const response = await fetch(`/api/catalogs/${catalogId}/items`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workId }),
    });
    setMessage(response.ok ? "已加入目录" : "收录失败");
  }
  if (!catalogs.length) return null;
  return <div className="flex flex-wrap items-center gap-2">
    <SelectField
      className="min-w-44"
      onValueChange={setCatalogId}
      options={catalogs.map((catalog) => ({ value: String(catalog.id), label: catalog.title }))}
      placeholder="加入目录"
      value={catalogId}
    />
    <Button disabled={!catalogId} onClick={() => void add()} size="sm" type="button" variant="outline">收录</Button>
    {message ? <span className="text-sm text-muted">{message}</span> : null}
  </div>;
}

function CommentCard({ comment, currentUserId, onReply, onLike, onDelete }: {
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
      const response = await fetch(`/api/comments/${comment.id}/replies`, { credentials: "same-origin" });
      const result = (await response.json()) as { ok?: boolean; items?: CommentDto[] };
      if (!response.ok || !result.ok) throw new Error();
      setReplies(result.items ?? []);
    } finally {
      setLoading(false);
    }
  }
  return (
    <article className="grid gap-3 rounded-md border border-border bg-card p-4" id={`comment-${comment.id}`}>
      <CommentLine comment={comment} />
      <CommentControls comment={comment} currentUserId={currentUserId} onDelete={onDelete} onLike={onLike} onReply={onReply} />
      {(comment.replyCount ?? 0) > 0 ? (
        <div className="grid gap-3 border-l-2 border-border pl-4">
          {replies?.map((reply) => (
            <div className="grid gap-2" id={`comment-${reply.id}`} key={reply.id}>
              <CommentLine comment={reply} compact />
              <CommentControls comment={reply} currentUserId={currentUserId} onDelete={onDelete} onLike={onLike} onReply={onReply} />
            </div>
          ))}
          {!replies ? <Button disabled={loading} onClick={loadReplies} size="sm" type="button" variant="ghost">{loading ? "加载中" : `查看 ${comment.replyCount} 条回复`}</Button> : null}
        </div>
      ) : null}
    </article>
  );
}

function CommentLine({ comment, compact = false }: { comment: CommentDto; compact?: boolean }) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <strong>{comment.author?.displayName ?? "已删除用户"}</strong>
        <span className="text-muted">{new Date(comment.createdAt).toLocaleString("zh-CN")}</span>
        {comment.editedAt ? <span className="text-muted">已编辑</span> : null}
        {comment.status === "deleted" ? <span className="text-muted">已删除</span> : null}
      </div>
      <p className={compact ? "text-sm whitespace-pre-wrap break-words" : "whitespace-pre-wrap break-words"}>
        {comment.replyTo ? <span className="text-muted">回复 @{comment.replyTo.displayName ?? "已删除用户"}：</span> : null}
        <CommentBody body={comment.body} />
      </p>
    </div>
  );
}

function CommentBody({ body }: { body: CommentBodySegment[] }) {
  return body.map((segment, index) => segment.type === "text"
    ? <span key={index}>{segment.text}</span>
    : <Image alt={segment.alt} className="mx-0.5 inline-block h-6 w-6 align-text-bottom" height={24} key={`${segment.shortcode}-${index}`} src={segment.imageUrl} unoptimized width={24} />);
}

function CommentControls({ comment, currentUserId, onReply, onLike, onDelete }: {
  comment: CommentDto;
  currentUserId: number | null;
  onReply: (comment: CommentDto) => void;
  onLike: (comment: CommentDto) => void;
  onDelete: (comment: CommentDto) => void;
}) {
  if (comment.status === "deleted") return null;
  return <div className="flex flex-wrap items-center gap-1">
    {currentUserId ? <Button onClick={() => onReply(comment)} size="sm" type="button" variant="ghost"><MessageCircle /> 回复</Button> : null}
    {currentUserId ? <Button aria-pressed={comment.likedByMe} onClick={() => onLike(comment)} size="sm" type="button" variant={comment.likedByMe ? "outline" : "ghost"}><Heart /> {comment.likeCount}</Button> : <span className="px-2 text-sm text-muted">{comment.likeCount} 赞</span>}
    {currentUserId === comment.author?.id ? <Button onClick={() => onDelete(comment)} size="sm" type="button" variant="ghost"><Trash2 /> 删除</Button> : null}
  </div>;
}

function EmojiPicker({ emojis, onSelect }: { emojis: CustomEmojiDto[]; onSelect: (shortcode: string) => void }) {
  const [open, setOpen] = useState(false);
  return <div className="relative">
    <Button aria-expanded={open} onClick={() => setOpen((value) => !value)} size="sm" type="button" variant="ghost"><Smile /> 表情</Button>
    {open ? <div className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-80 overflow-hidden rounded-md border border-border bg-card p-2 shadow-lg">
      <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto">
        {emojis.length ? emojis.map((emoji) => <Button aria-label={`插入 :${emoji.shortcode}:`} className="grid h-9 w-9 p-0" key={emoji.shortcode} onClick={() => { onSelect(emoji.shortcode); setOpen(false); }} title={`:${emoji.shortcode}:`} type="button" variant="ghost"><Image alt={emoji.name} height={24} src={emoji.imageUrl} unoptimized width={24} /></Button>) : <span className="col-span-6 p-2 text-sm text-muted">暂无站点表情。</span>}
      </div>
    </div> : null}
  </div>;
}
