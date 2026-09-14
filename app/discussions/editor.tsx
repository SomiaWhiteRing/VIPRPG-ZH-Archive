"use client";
import { EmptyState } from "@/app/components/ui/empty-state";
import {ForumReplyBar,draftSnapshot,draftValue,forumReplyLauncherClass,type ForumDraft} from "./draft";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ImagePlus, Smile } from "lucide-react";

import Image from "next/image";
import { Button } from "@/app/components/ui/button";

import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";

import { FORUM_BODY_LENGTH, FORUM_POST_BODY_LENGTH, FORUM_COMMENT_LENGTH, FORUM_TITLE_LENGTH, type ForumViewer } from "@/lib/forum";
import type { CustomEmojiDto } from "@/lib/server/db/work-community";
import { ForumTagEditor, ForumModal, forumRequest } from "./shared";
import { ForumImages, existingDraftImages } from "./images";
import { MixedEditor, type MixedEditorHandle } from "./mixed-editor";

export function ForumEditor({
  draft,
  viewer,
  onChange,
  onBusyChange,
  onError,
  onCancel,
  onSubmit,
  onReload,
  busy,
  error,
  progress,
  loginExpired,
  conflict,
  emojis,
}: {
  draft: ForumDraft;
  viewer: ForumViewer;
  onChange: (draft: ForumDraft) => void;
  onBusyChange: (value: boolean) => void;
  onError: (message: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onReload: () => void;
  busy: boolean;
  error: string;
  progress: string;
  loginExpired: boolean;
  conflict: boolean;
  emojis: CustomEmojiDto[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [catalogue,setCatalogue]=useState<CustomEmojiDto[]|null>(null);
  async function openEmojis(){
    try{
      if(!catalogue)setCatalogue((await forumRequest<{emojis:CustomEmojiDto[]}>("/api/discussions?op=emojis")).emojis);
      setEmojiOpen(true);
    }catch(error){onError(error instanceof Error?error.message:"表情加载失败。");}
  }
  const picker = useRef<HTMLInputElement>(null);
  const mixed = useRef<MixedEditorHandle>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const section = useRef<HTMLElement>(null);
  const composing = useRef(false);
  const topic = draft.mode === "topic";
  const inline = draft.mode === "comment";
  const isCollapsed = collapsed && !error && !draft.currentVersion;
  const limit = inline ? FORUM_COMMENT_LENGTH : topic ? FORUM_BODY_LENGTH : FORUM_POST_BODY_LENGTH;
  const label = draft.target
    ? "保存修改"
    : topic
      ? "发布主题"
      : inline
        ? "回复"
        : "发表回复";
  const context = draft.target
    ? topic
      ? "编辑主题"
      : `编辑 #${draft.postNumber}${inline ? " 的楼内回复" : ""}`
    : topic
      ? "新主题"
      : inline
        ? `回复 #${draft.postNumber}`
        : `回复：${draft.title}`;

  useEffect(() => {
    if (topic || inline || isCollapsed || busy || emojiOpen) return;
    function outside(event: PointerEvent) {
      const target = event.target;
      if (
        composing.current ||
        !(target instanceof Element) ||
        section.current?.contains(target) ||
        target.closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [data-forum-reply-bar]',
        )
      )
        return;
      setCollapsed(true);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [topic, inline, isCollapsed, busy, emojiOpen]);

  useEffect(() => {
    const input = ref.current;
    if (!input || topic || isCollapsed) return;
    function fit() {
      if (!input) return;
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [draft.body, topic, isCollapsed]);

  const form = (
    <section
      ref={section}
      data-forum-editor
      aria-label={context}
      className={
        topic
          ? "flex min-h-0 flex-1 flex-col"
          : inline
            ? "mt-3 border-t border-border pt-3"
            : "min-w-0"
      }
    >
      {isCollapsed && !topic && !inline ? (
        <Button
          variant="ghost"
          type="button"
          className={forumReplyLauncherClass}
          onClick={() => {
            setCollapsed(false);
            requestAnimationFrame(() => mixed.current?.focus());
          }}
        >
          <span className="shrink-0 text-foreground">
            {draft.target ? `编辑 #${draft.postNumber}` : "回复主题"}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {draft.body.trim() || "写下你的回复……"}
            {draft.images.length ? ` · 图片 × ${draft.images.length}` : ""}
          </span>
          {draftValue(draft) !== draftValue(draft.original) ? (
            <span className="shrink-0 text-xs text-primary">未提交</span>
          ) : null}
        </Button>
      ) : null}
        <form
          className={isCollapsed ? "hidden" : "flex min-h-0 flex-1 flex-col gap-2"}
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && !conflict && !draft.currentVersion) onSubmit();
          }}
        >
          <div
            className={
              topic
                ? "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2"
                : "flex max-h-[min(50dvh,calc(var(--reply-viewport,100dvh)-10rem))] flex-col gap-2 overflow-y-auto"
            }
          >
            {draft.currentVersion ? (
              <ForumConflictResolver
                key={`${draft.currentVersion.revision}-${draft.currentVersion.topic.revision}`}
                draft={draft}
                current={draft.currentVersion}
                onChange={onChange}
              />
            ) : null}
            {topic ? (
              <>
                <div>
                  <Label htmlFor="forum-title">标题</Label>
                  <Input
                    autoFocus
                    id="forum-title"
                    value={draft.title}
                    maxLength={FORUM_TITLE_LENGTH}
                    required
                    disabled={busy}
                    onChange={(event) =>
                      onChange({ ...draft, title: event.target.value })
                    }
                  />
                </div>
                <ForumTagEditor
                  id="forum-editor-tags"
                  disabled={busy}
                  values={draft.tags}
                  onChange={(tags) => onChange({ ...draft, tags })}
                />
                {draft.target ? (
                  <p className="text-xs text-muted">
                    修改并保存 TAG 时会移除已不可见的标签关联。
                  </p>
                ) : null}
              </>
            ) : draft.target || inline ? (
              <p className="text-xs font-semibold text-muted">{context}</p>
            ) : null}
            {draft.replyToId ? (
              <div className="flex items-center gap-2 text-sm">
                回复 {draft.replyName}
                <Button
                  disabled={busy}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange({
                      ...draft,
                      replyToId: undefined,
                      replyName: undefined,
                    })
                  }
                >
                  取消定向回复
                </Button>
              </div>
            ) : null}
            <div
              className={
                topic ? "flex min-h-48 shrink-0 flex-col gap-1" : "min-w-0"
              }
            >
              <Label
                className={topic ? undefined : "sr-only"}
                htmlFor="forum-body"
              >
                正文
              </Label>
              {!inline ? (
                <MixedEditor
                  ref={mixed}
                  body={draft.body}
                  images={draft.images}
                  busy={busy}
                  topic={topic}
                  onBusyChange={onBusyChange}
                  onError={onError}
                  onCompositionChange={(value) => { composing.current = value; }}
                  onChange={(body, images) =>
                    onChange({ ...draft, body, images })
                  }
                />
              ) : (
                <Textarea
                  ref={ref}
                  autoFocus
                  id="forum-body"
                  rows={2}
                  placeholder={
                    draft.replyToId
                      ? `回复 ${draft.replyName}……`
                      : `回复 #${draft.postNumber}……`
                  }
                  className="min-h-16 max-h-[min(32dvh,calc(var(--reply-viewport,100dvh)-12rem))] shrink-0 resize-none text-base leading-relaxed"
                  aria-describedby={error ? "forum-editor-error" : undefined}
                  maxLength={limit}
                  value={draft.body}
                  required
                  disabled={busy}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  onChange={(event) =>
                    onChange({ ...draft, body: event.target.value })
                  }
                />
              )}
            </div>
            {progress ? (
              <p role="status" className="text-sm text-muted">
                {progress}
              </p>
            ) : null}
            {error ? (
              <div
                id="forum-editor-error"
                role="alert"
                className="text-sm text-destructive"
              >
                <p>{error}</p>
                {loginExpired ? (
                  <a
                    className="underline"
                    href="/login?next=%2Fdiscussions"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    在新标签页重新登录
                  </a>
                ) : null}
                {conflict ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={onReload}
                  >
                    读取当前版本
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="站点表情"
              title="站点表情"
              disabled={busy}
              onClick={() => void openEmojis()}
            >
              <Smile />
            </Button>
            {!inline ? (
              <>
                <Input
                  ref={picker}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  aria-label="选择图片"
                  disabled={busy}
                  onChange={(event) => {
                    mixed.current?.insertFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="添加图片"
                  title="添加图片"
                  disabled={busy}
                  onClick={() => picker.current?.click()}
                >
                  <ImagePlus />
                </Button>
              </>
            ) : null}
            <span className="font-mono text-xs text-muted">
              <span className="sr-only">正文字数：</span>
              {draft.body.length}
              <span className="hidden sm:inline"> / {limit}</span>
            </span>
            <div className="ml-auto flex items-center gap-1">
              {!topic && !inline ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="收起回复"
                  title="收起回复"
                  disabled={busy || !!error || !!draft.currentVersion}
                  onClick={() => {
                    setCollapsed(true);
                    requestAnimationFrame(() =>
                      section.current
                        ?.querySelector<HTMLButtonElement>("button")
                        ?.focus({ preventScroll: true }),
                    );
                  }}
                >
                  <ChevronDown />
                </Button>
              ) : null}
              {!topic ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={onCancel}
                >
                  取消
                </Button>
              ) : null}
              <Button
                disabled={busy || conflict || !!draft.currentVersion}
                type="submit"
              >
                {busy ? "正在保存…" : label}
              </Button>
            </div>
          </div>
        </form>
      <ForumModal open={emojiOpen} onOpenChange={setEmojiOpen} title="站点表情">
        <div className="grid grid-cols-6 gap-2">
          {(catalogue??emojis)
            .filter(
              (emoji) => emoji.status === "active" && emoji.visibleInPicker,
            )
            .map((emoji) => (
              <Button
                className="h-12"
                variant="ghost"
                type="button"
                key={emoji.id}
                aria-label={emoji.name}
                title={emoji.name}
                onClick={() => {
                  if (!inline) {
                    mixed.current?.insertText(`:${emoji.shortcode}:`);
                    setEmojiOpen(false);
                    return;
                  }
                  const start = ref.current?.selectionStart ?? draft.body.length;
                  const end = ref.current?.selectionEnd ?? start;
                  const body =
                    draft.body.slice(0, start) +
                    `:${emoji.shortcode}:` +
                    draft.body.slice(end);
                  if (body.length > limit) return;
                  onChange({
                    ...draft,
                    body,
                  });
                  setEmojiOpen(false);
                  requestAnimationFrame(() => {
                    ref.current?.focus();
                    const caret = start + emoji.shortcode.length + 2;
                    ref.current?.setSelectionRange(caret, caret);
                  });
                }}
              >
                <Image
                  alt={emoji.name}
                  width={24}
                  height={24}
                  src={emoji.imageUrl}
                  unoptimized
                />
              </Button>
            ))}
        </div>
        {catalogue?.length===0 ? <EmptyState title="还没有可用的表情。" variant="plain" /> : null}
      </ForumModal>
    </section>
  );
  if (topic)
    return (
      <ForumModal
        open
        onOpenChange={(open) => {
          if (!open) onCancel();
        }}
        title={context}
        editor
        busy={busy}
      >
        {form}
      </ForumModal>
    );
  return inline ? form : <ForumReplyBar viewer={viewer}>{form}</ForumReplyBar>;
}

function ForumConflictResolver({
  draft,
  current,
  onChange,
}: {
  draft: ForumDraft;
  current: NonNullable<ForumDraft["currentVersion"]>;
  onChange: (draft: ForumDraft) => void;
}) {
  const [title, setTitle] = useState("current");
  const [tags, setTags] = useState("current");
  const [body, setBody] = useState("draft");

  const currentTags = current.topic.tags.map((tag) => tag.name);
  return (
    <section
      className="grid gap-3 border-b border-border pb-3"
      aria-label="核对编辑冲突"
    >
      <h3 className="text-sm font-bold">内容已变化，请核对后继续</h3>
      {draft.mode === "topic" ? (
        <>
          <ConflictField
            id="conflict-title"
            label="标题"
            current={current.topic.title}
            draft={draft.title}
            value={title}
            onChange={setTitle}
          />
          <ConflictField
            id="conflict-tags"
            label="TAG"
            current={currentTags.map((tag) => `[${tag}]`).join(" ") || "无 TAG"}
            draft={draft.tags.map((tag) => `[${tag}]`).join(" ") || "无 TAG"}
            value={tags}
            onChange={setTags}
          />
        </>
      ) : null}
      {draft.mode === "comment" ? (
        <ConflictField
          id="conflict-body"
          label="正文"
          current={current.body}
          draft={draft.body}
          value={body}
          onChange={setBody}
        />
      ) : (
        <div className="grid gap-2">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="max-h-64 overflow-auto">
              <p className="text-sm font-bold">当前正文</p>
              <ForumImages body={current.body} images={current.images} />
            </div>
            <div className="max-h-64 overflow-auto">
              <p className="text-sm font-bold">我的正文</p>
              <ForumImages
                body={draft.body}
                images={draft.images.map((image) => ({
                  id: image.key,
                  offset: image.offset,
                  url: image.preview,
                  thumb: image.preview,
                  width: image.uploaded?.width ?? 320,
                  height: image.uploaded?.height ?? 180,
                  size: image.size,
                  format: image.uploaded?.format ?? "png",
                }))}
              />
            </div>
          </div>
          <Label htmlFor="conflict-body">采用的图文正文</Label>
          <SelectField
            id="conflict-body"
            value={body}
            onValueChange={setBody}
            options={[
              { value: "current", label: "当前版本" },
              { value: "draft", label: "我的修改" },
            ]}
          />
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={() => {
          const baseline = {
            ...draft,
            title: current.topic.title,
            tags: currentTags,
            body: current.body,
            images: existingDraftImages(current.images),
          };
          onChange({
            ...baseline,
            title:
              draft.mode === "topic" && title === "draft"
                ? draft.title
                : baseline.title,
            tags:
              draft.mode === "topic" && tags === "draft"
                ? draft.tags
                : baseline.tags,
            body: body === "draft" ? draft.body : baseline.body,
            images: body === "draft" ? draft.images : baseline.images,
            original: draftSnapshot(baseline),
            revision: current.revision,
            topicRevision: current.topic.revision,
            currentVersion: undefined,
          });
        }}
      >
        应用选择，继续编辑
      </Button>
    </section>
  );
}

function ConflictField({
  id,
  label,
  current,
  draft,
  value,
  onChange,
}: {
  id: string;
  label: string;
  current: string;
  draft: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor={`${id}-current`}>当前{label}</Label>
          <Textarea
            id={`${id}-current`}
            className="max-h-36 text-sm"
            readOnly
            value={current}
          />
        </div>
        <div className="min-w-0">
          <Label htmlFor={`${id}-draft`}>我的{label}</Label>
          <Textarea
            id={`${id}-draft`}
            className="max-h-36 text-sm"
            readOnly
            value={draft}
          />
        </div>
      </div>
      <div>
        <Label htmlFor={id}>采用的{label}</Label>
        <SelectField
          id={id}
          value={value}
          onValueChange={onChange}
          options={[
            { value: "current", label: "当前版本" },
            { value: "draft", label: "我的修改" },
          ]}
        />
      </div>
    </div>
  );
}
