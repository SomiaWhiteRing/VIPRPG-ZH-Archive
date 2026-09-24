import { EmojiPicker } from "@/app/components/emojis/picker";
import { bodyLength } from "@/lib/face-emojis";
import { ChevronDown, ImagePlus, Maximize2, Minimize2 } from "lucide-react";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ForumDraft } from "./draft";
import { draftSnapshot, forumReplyLauncherClass } from "./draft";

import { HeightBox } from "@/app/components/ui/height-box";
import { Button } from "@/app/components/ui/button";

import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";

import type { FaceEmoji } from "@/lib/dto/db/work-community";
import {
  FORUM_BODY_LENGTH,
  FORUM_COMMENT_LENGTH,
  FORUM_POST_BODY_LENGTH,
  FORUM_TITLE_LENGTH,
} from "@/lib/forum";
import { ForumImages, existingDraftImages } from "./images";
import {
  BodyEditor,
  type BodyEditorHandle,
} from "@/app/components/comments/body-editor";
import { ForumModal, ForumTagEditor } from "./shared";
import { ForumReplyLayoutContext } from "./reply-bar";

export function ForumEditor({
  draft,
  onChange,
  onError,
  onCancel,
  onSubmit,
  onReload,
  busy: submitting,
  error,
  progress,
  loginExpired,
  conflict,
  emojis,
}: {
  draft: ForumDraft;
  onChange: (draft: ForumDraft) => void;
  onError: (message: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onReload: () => void;
  busy: boolean;
  error: string;
  progress: string;
  loginExpired: boolean;
  conflict: boolean;
  emojis: FaceEmoji[];
}) {
  // Local image preparation locks editor actions without marking a publish
  // request in flight or enabling the page's unload guard on an empty draft.
  const [processingImages, setProcessingImages] = useState(false);
  const busy = submitting || processingImages;
  const [collapsed, setCollapsed] = useState(draft.collapsed ?? false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const mixed = useRef<BodyEditorHandle>(null);
  const section = useRef<HTMLElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const originalHeight = useRef(0);
  const replyLayout = useContext(ForumReplyLayoutContext);
  const fullscreen = replyLayout?.fullscreen ?? false;
  const setFullscreen = replyLayout?.setFullscreen;
  const [overflowing, setOverflowing] = useState(false);
  const composing = useRef(false);
  const topic = draft.mode === "topic";
  const inline = draft.mode === "comment";
  const isCollapsed = collapsed && !error && !draft.currentVersion;
  const limit = inline
    ? FORUM_COMMENT_LENGTH
    : topic
      ? FORUM_BODY_LENGTH
      : FORUM_POST_BODY_LENGTH;
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

  useLayoutEffect(() => {
    if (!setFullscreen || fullscreen || isCollapsed) return;
    const area = scrollArea.current;
    if (!area) return;
    const observer = new ResizeObserver(measure);
    function measure() {
      if (!area) return;
      const textbox = area.querySelector<HTMLElement>('[role="textbox"]');
      if (textbox) observer.observe(textbox);
      setOverflowing(
        [area, textbox].some((node) => node && node.scrollHeight > node.clientHeight + 1),
      );
    }
    const mutations = new MutationObserver(measure);
    observer.observe(area);
    mutations.observe(area, { childList: true, characterData: true, subtree: true });
    measure();
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [setFullscreen, fullscreen, isCollapsed]);

  useLayoutEffect(() => {
    if (!fullscreen) return;
    const editor = section.current;
    if (!editor) return;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    const gutter = root.style.scrollbarGutter;
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    const inactive: [HTMLElement, boolean][] = [];
    for (let node: HTMLElement | null = editor; node?.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && sibling instanceof HTMLElement) {
          inactive.push([sibling, sibling.inert]);
          sibling.inert = true;
        }
      }
      if (node.parentElement === document.body) break;
    }
    const viewport = window.visualViewport;
    function resize() {
      if (!editor) return;
      editor.style.top = `${viewport?.offsetTop ?? 0}px`;
      editor.style.height = `${viewport?.height ?? window.innerHeight}px`;
    }
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => {
      root.style.overflow = overflow;
      root.style.scrollbarGutter = gutter;
      for (const [node, inert] of inactive) node.inert = inert;
      editor.style.top = "";
      editor.style.height = "";
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
    };
  }, [fullscreen]);
  useEffect(() => () => setFullscreen?.(false), [setFullscreen]);

  useEffect(() => {
    if (topic || inline || isCollapsed || busy || emojiOpen || fullscreen) return;
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
  }, [topic, inline, isCollapsed, busy, emojiOpen, fullscreen]);

  const form = (
    <HeightBox
      className={topic ? "contents" : undefined}
      height={fullscreen ? originalHeight.current : undefined}
    >
    <section
      ref={section}
      data-forum-editor
      data-forum-fullscreen={fullscreen}
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={context}
      onKeyDown={(event) => {
        if (fullscreen && event.key === "Escape" && !emojiOpen) {
          event.preventDefault();
          event.stopPropagation();
          setFullscreen?.(false);
        }
      }}
      className={
        fullscreen
          ? "fixed inset-x-0 top-0 z-[60] flex h-dvh min-h-0 flex-col bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          : topic
          ? "flex min-h-0 flex-1 flex-col"
          : inline
            ? "mt-3 border-t border-border pt-3"
            : "relative min-w-0"
      }
    >
      {!topic && !inline ? (
        <Button
          variant="ghost"
          type="button"
          inert={!isCollapsed}
          aria-hidden={!isCollapsed}
          className={`${forumReplyLauncherClass} transition-opacity duration-240 motion-reduce:transition-none ${
            isCollapsed
              ? "relative opacity-100"
              : "pointer-events-none absolute inset-x-0 top-0 opacity-0"
          }`}
          onClick={() => {
            setCollapsed(false);
            requestAnimationFrame(() => mixed.current?.focus());
          }}
        >
          <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {draft.body.trim() || "回复主题……"}
          </span>
        </Button>
      ) : null}
      <form
        inert={isCollapsed}
        aria-hidden={isCollapsed}
        className={
          "flex min-h-0 flex-1 flex-col gap-2" +
          (!topic && !inline
            ? ` transition-opacity duration-240 motion-reduce:transition-none ${
                isCollapsed
                  ? "pointer-events-none absolute inset-x-0 top-0 max-h-full overflow-clip opacity-0"
                  : "relative opacity-100"
              }`
            : "")
        }
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !conflict && !draft.currentVersion) onSubmit();
        }}
      >
        <div
          ref={scrollArea}
          className={
            fullscreen
              ? "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain"
              : topic
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
              topic
                ? "flex min-h-48 shrink-0 flex-col gap-1"
                : fullscreen
                  ? "flex min-h-48 shrink-0 flex-1 flex-col gap-1"
                  : "min-w-0"
            }
          >
            <Label
              className={topic ? undefined : "sr-only"}
              htmlFor="forum-body"
            >
              正文
            </Label>
            <BodyEditor
              ref={mixed}
              body={draft.body}
              images={draft.images}
              busy={busy}
              topic={topic}
              textOnly={inline}
              maxLength={limit}
              autoFocus={!topic && !isCollapsed}
              emojis={emojis}
              onBusyChange={setProcessingImages}
              onError={onError}
              onCompositionChange={(value) => {
                composing.current = value;
              }}
              onChange={(body, images) => onChange({ ...draft, body, images })}
            />
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
        <EmojiPicker
          disabled={busy}
          onOpenChange={setEmojiOpen}
          onMobilePanelOpenChange={replyLayout?.setMobileEmojiOpen}
          onSelect={(emoji, options) =>
            mixed.current?.insertEmoji(emoji, options)
          }
          onClose={() => mixed.current?.focus()}
        >
          {(trigger) => (
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              {trigger}
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
                      mixed.current?.insertFiles(
                        Array.from(event.target.files ?? []),
                      );
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
                {bodyLength(draft.body)}
                <span className="hidden sm:inline"> / {limit}</span>
              </span>
              <div className="ml-auto flex items-center gap-1">
                {setFullscreen && (overflowing || fullscreen) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={fullscreen ? "退出全屏" : "全屏编辑"}
                    title={fullscreen ? "退出全屏" : "全屏编辑"}
                    aria-pressed={fullscreen}
                    onClick={() => {
                      if (!fullscreen)
                        originalHeight.current = section.current?.getBoundingClientRect().height ?? 0;
                      setFullscreen(!fullscreen);
                    }}
                  >
                    {fullscreen ? <Minimize2 /> : <Maximize2 />}
                  </Button>
                ) : null}
                {!topic && !inline ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="收起回复"
                    title="收起回复"
                    disabled={busy || !!error || !!draft.currentVersion}
                    onClick={() => {
                      if (fullscreen) {
                        setFullscreen?.(false);
                        return;
                      }
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
                    关闭
                  </Button>
                ) : null}
                <Button
                  disabled={busy || conflict || !!draft.currentVersion}
                  type="submit"
                >
                  {submitting ? "正在保存…" : label}
                </Button>
              </div>
            </div>
          )}
        </EmojiPicker>
      </form>
    </section>
    </HeightBox>
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
  return form;
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
