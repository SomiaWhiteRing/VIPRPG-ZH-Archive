import {
  bodyLength,
  emojiIds,
  emojiToken,
  type FaceEmoji,
} from "@/lib/face-emojis";
import {
  EditorEmojis,
  FaceEmojiNode,
} from "@/app/components/emojis/editor-node";
import { resolveEmojis } from "@/app/components/emojis/client";
import { Button } from "@/app/components/ui/button";
import {
  FORUM_BODY_LENGTH,
  FORUM_IMAGE_COUNT,
  FORUM_POST_BODY_LENGTH,
} from "@/lib/forum";
import { Extension, Node as TiptapNode } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Dropcursor, Placeholder, UndoRedo } from "@tiptap/extensions";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { SelectionBookmark } from "@tiptap/pm/state";
import { Plugin } from "@tiptap/pm/state";
import type { NodeViewProps } from "@tiptap/react";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from "@tiptap/react";
import { X } from "lucide-react";
import type { Ref } from "react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  editorDocument,
  imageContent,
  inlineSlice,
  readDocument,
  textContent,
} from "@/app/discussions/editor-document";
import { createImageProcessor } from "@/app/discussions/image-processor";
import type { DraftImage } from "@/app/discussions/images";
import { cloneDraftImage, selectDraftImages } from "@/app/discussions/images";

const EMPTY_EMOJIS: FaceEmoji[] = [];

export type BodyEditorHandle = {
  insertFiles: (files: File[]) => void;
  insertText: (text: string) => void;
  insertEmoji: (emoji: FaceEmoji, options?: { focus?: boolean }) => void;
  focus: () => void;
};

function ImageNode({ node, selected, editor, deleteNode }: NodeViewProps) {
  return (
    <NodeViewWrapper
      as="span"
      className="relative my-2 block w-fit max-w-full rounded-[2px] data-selected:outline-2 data-selected:outline-primary data-selected:outline-offset-2"
      contentEditable={false}
      data-selected={selected || undefined}
    >
      <img
        src={node.attrs.src}
        alt="正文图片"
        width={640}
        height={360}
        draggable
        data-drag-handle
        className="block h-auto max-h-64 w-auto max-w-full object-contain"
        loading="lazy"
      />
      {selected && editor.isEditable ? (
        <Button
          type="button"
          size="icon"
          variant="neutral"
          className="absolute top-1 right-1"
          aria-label="删除选中图片"
          title="删除图片"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (editor.isEditable) {
              deleteNode();
              editor.commands.focus();
            }
          }}
        >
          <X />
        </Button>
      ) : null}
      {node.attrs.error ? (
        <span role="alert" className="block text-sm text-destructive">
          {node.attrs.error}
        </span>
      ) : null}
    </NodeViewWrapper>
  );
}

const ForumImageNode = TiptapNode.create({
  name: "forumImage",
  inline: true,
  group: "inline",
  atom: true,
  draggable: true,
  addAttributes: () => ({
    key: { default: null },
    src: { default: null },
    error: { default: null, rendered: false },
  }),
  parseHTML: () => [
    {
      tag: "img[data-forum-image]",
      getAttrs: (element) => ({
        key: element.getAttribute("data-forum-image"),
      }),
    },
  ],
  renderHTML: ({ node }) => [
    "img",
    {
      "data-forum-image": node.attrs.key,
      src: node.attrs.src,
      alt: "正文图片",
    },
  ],
  addNodeView: () => ReactNodeViewRenderer(ImageNode, { as: "span" }),
});

export function BodyEditor({
  body,
  images,
  busy,
  topic,
  onChange,
  onBusyChange,
  onError,
  onCompositionChange,
  ref,
  textOnly = false,
  maxLength,
  inputId = "forum-body",
  placeholder = "写下正文……",
  autoFocus = false,
  emojis = EMPTY_EMOJIS,
}: {
  textOnly?: boolean;
  maxLength?: number;
  inputId?: string;
  placeholder?: string;
  autoFocus?: boolean;
  emojis?: FaceEmoji[];
  body: string;
  images: DraftImage[];
  busy: boolean;
  topic: boolean;
  onChange: (body: string, images: DraftImage[]) => void;
  onBusyChange: (value: boolean) => void;
  onError: (message: string) => void;
  onCompositionChange: (value: boolean) => void;
  ref?: Ref<BodyEditorHandle>;
}) {
  const limit =
    maxLength ?? (topic ? FORUM_BODY_LENGTH : FORUM_POST_BODY_LENGTH);
  const [loadedEmojis, setLoadedEmojis] = useState<FaceEmoji[]>([]);
  const [emojiError, setEmojiError] = useState("");
  const [retry, setRetry] = useState(0);
  const idsKey = JSON.stringify(emojiIds(body));
  useEffect(() => {
    const controller = new AbortController();
    void resolveEmojis(JSON.parse(idsKey) as number[], controller.signal)
      .then((items) => {
        setLoadedEmojis(items);
        setEmojiError("");
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setEmojiError(
            error instanceof Error ? error.message : "表情加载失败。",
          );
      });
    return () => controller.abort();
  }, [idsKey, retry]);
  const emojiMap = new Map(
    [...emojis, ...loadedEmojis].map((emoji) => [emoji.id, emoji]),
  );
  // Keep resources removed by editing alive for undo/redo until the draft ends.
  const [assets] = useState(
    () => new Map(images.map((image) => [image.key, image])),
  );
  const processor = useRef<ReturnType<typeof createImageProcessor> | null>(
    null,
  );
  const mounted = useRef(true);
  const pending = useRef<{ bookmark: SelectionBookmark } | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      Document.extend({ content: "paragraph" }),
      Paragraph.extend({
        addKeyboardShortcuts() {
          return { Enter: () => this.editor.commands.setHardBreak() };
        },
      }),
      Text,
      HardBreak,
      ...(textOnly ? [] : [ForumImageNode]),
      FaceEmojiNode,
      UndoRedo,
      Dropcursor.configure({ color: "var(--color-primary)", width: 2 }),
      Placeholder.configure({ placeholder }),
      Extension.create({
        name: "forumLimits",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              filterTransaction(transaction) {
                if (!transaction.docChanged) return true;
                const value = readDocument(transaction.doc, assets);
                return (
                  bodyLength(value.body) <= limit &&
                  value.images.length <= FORUM_IMAGE_COUNT &&
                  new Set(value.images.map((image) => image.key)).size ===
                    value.images.length
                );
              },
            }),
          ];
        },
      }),
    ],
    content: editorDocument(body, images),
    editorProps: {
      attributes: {
        id: inputId,
        role: "textbox",
        "aria-label": "正文",
        "aria-multiline": "true",
        class: "min-h-16 p-3 outline-none text-[15px] leading-[1.7] [overflow-wrap:anywhere] whitespace-pre-wrap group-data-[topic=true]/body-editor:min-h-48 group-data-[topic=false]/body-editor:max-h-[min(32dvh,20rem)] group-data-[topic=false]/body-editor:overflow-y-auto [&_p]:m-0 [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_.is-editor-empty:first-child]:before:text-muted [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:h-0 [&_[data-node-view-wrapper]]:whitespace-normal [&_.node-faceEmoji]:inline-flex [&_.node-faceEmoji]:align-bottom [[data-forum-fullscreen=true]_&]:flex-1 [[data-forum-fullscreen=true]_&]:max-h-none [[data-forum-fullscreen=true]_&]:overflow-y-visible",
      },
      handleDOMEvents: {
        compositionstart: () => {
          onCompositionChange(true);
          return false;
        },
        compositionend: () => {
          onCompositionChange(false);
          return false;
        },
      },
      transformPasted: (slice, view) =>
        inlineSlice(slice, view.state.schema, assets),
      clipboardTextSerializer: (slice) =>
        slice.content.textBetween(0, slice.content.size, "\n", (node) =>
          node.type.name === "hardBreak"
            ? "\n"
            : node.type.name === "faceEmoji"
              ? emojiToken(node.attrs.id)
              : "",
        ),
      handlePaste: (_view, event, slice) => {
        if (busy || pending.current) return true;
        if (textOnly) return false;
        const files = Array.from(event.clipboardData?.files ?? []);
        // Internal HTML represents an editable slice, even if the browser also provides a file.
        if (
          slice.content.content.some((node) => node.type.name === "forumImage")
        )
          void insertSlice(slice);
        else if (files.length) void insertFiles(files);
        else return false;
        return true;
      },
      handleDrop: (view, event, slice, moved) => {
        if (busy || pending.current) return true;
        if (textOnly) return false;
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        const point = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (point) editor?.commands.setTextSelection(point.pos);
        if (files.length) void insertFiles(files);
        else void insertSlice(inlineSlice(slice, view.state.schema, assets));
        return true;
      },
    },
    onTransaction: ({ transaction }) => {
      if (pending.current)
        pending.current.bookmark = pending.current.bookmark.map(
          transaction.mapping,
        );
    },
    onUpdate: ({ editor }) => {
      const value = readDocument(editor.state.doc, assets);
      onChange(value.body, value.images);
    },
  });

  useEffect(() => {
    if (!editor) return;
    for (const image of images) assets.set(image.key, image);
    const current = readDocument(editor.state.doc, assets);
    if (
      current.body !== body ||
      JSON.stringify(
        current.images.map((image) => [image.key, image.offset]),
      ) !== JSON.stringify(images.map((image) => [image.key, image.offset]))
    ) {
      editor.commands.setContent(editorDocument(body, images), {
        emitUpdate: false,
      });
    } else {
      const transaction = editor.state.tr;
      transaction.doc.descendants((node, pos) => {
        if (node.type.name !== "forumImage") return;
        const image = assets.get(node.attrs.key);
        if (
          image &&
          (node.attrs.src !== image.preview ||
            node.attrs.error !== (image.error ?? null))
        )
          transaction.setNodeMarkup(pos, undefined, imageContent(image).attrs);
      });
      if (transaction.docChanged)
        editor.view.dispatch(
          transaction
            .setMeta("addToHistory", false)
            .setMeta("preventUpdate", true),
        );
    }
  }, [editor, body, images, assets]);
  useEffect(() => {
    editor?.setEditable(!busy, false);
  }, [editor, busy]);
  useEffect(() => {
    if (editor && autoFocus) editor.commands.focus("end");
  }, [editor, autoFocus]);

  async function insert(content: (current: DraftImage[]) => Promise<Slice>) {
    if (!editor || editor.isDestroyed || busy || pending.current) return;
    pending.current = { bookmark: editor.state.selection.getBookmark() };
    onBusyChange(true);
    onError("");
    try {
      const { from, to } = editor.state.selection;
      const remaining: DraftImage[] = [];
      editor.state.doc.descendants((node, pos) => {
        const image =
          node.type.name === "forumImage"
            ? assets.get(node.attrs.key)
            : undefined;
        if (image && (pos < from || pos >= to)) remaining.push(image);
      });
      const slice = await content(remaining);
      if (!mounted.current || editor.isDestroyed) return;
      const transaction = closeHistory(editor.state.tr);
      transaction.setSelection(
        pending.current.bookmark.resolve(transaction.doc),
      );
      transaction.replaceSelection(slice).scrollIntoView();
      const result = readDocument(transaction.doc, assets);
      if (bodyLength(result.body) > limit)
        throw new Error("正文超过单帖限制，请减少后再插入。");
      editor.view.dispatch(transaction);
      editor.view.dispatch(closeHistory(editor.state.tr));
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) editor.commands.focus();
      });
    } catch (error) {
      if (mounted.current)
        onError(error instanceof Error ? error.message : "图片插入失败。");
    } finally {
      pending.current = null;
      if (mounted.current) onBusyChange(false);
    }
  }
  function insertFiles(files: File[]) {
    if (!files.length) return;
    return insert(async () => {
      processor.current ??= createImageProcessor();
      if (
        readDocument(editor!.state.doc, assets).images.length + files.length >
        FORUM_IMAGE_COUNT
      )
        throw new Error("每帖最多 10 张图片。");
      const added = await selectDraftImages(files, processor.current.process);
      if (!mounted.current) {
        for (const image of added) URL.revokeObjectURL(image.preview);
        throw new Error("图片处理已取消。");
      }
      for (const image of added) assets.set(image.key, image);
      return new Slice(
        Fragment.from(
          added.map((image) =>
            editor!.schema.nodeFromJSON(imageContent(image)),
          ),
        ),
        0,
        0,
      );
    });
  }
  function insertSlice(slice: Slice) {
    return insert(async () => {
      const { from, to } = editor!.state.selection;
      const present = new Set<string>();
      editor!.state.doc.descendants((node, pos) => {
        if (node.type.name === "forumImage" && (pos < from || pos >= to))
          present.add(node.attrs.key);
      });
      const nodes = [];
      for (const node of slice.content.content) {
        const source =
          node.type.name === "forumImage"
            ? assets.get(node.attrs.key)
            : undefined;
        if (!source || !present.has(source.key)) {
          nodes.push(node);
          if (source) present.add(source.key);
          continue;
        }
        // A second occurrence gets its own upload identity under the existing one-image/one-slot contract.
        let file = source.file;
        if (!file) {
          const response = await fetch(source.preview, {
            signal: AbortSignal.timeout(15000),
            credentials: "same-origin",
          });
          if (!response.ok) throw new Error("图片暂时无法复制，请稍后重试。");
          file = new File([await response.blob()], "image", {
            type: `image/${source.uploaded!.format}`,
          });
        }
        const copy = await cloneDraftImage(file);
        if (!mounted.current) {
          URL.revokeObjectURL(copy.preview);
          throw new Error("图片处理已取消。");
        }
        assets.set(copy.key, copy);
        nodes.push(editor!.schema.nodeFromJSON(imageContent(copy)));
        present.add(copy.key);
      }
      return new Slice(Fragment.from(nodes), 0, 0);
    });
  }
  useImperativeHandle(ref, () => ({
    insertFiles: (files) => {
      if (!textOnly) void insertFiles(files);
    },
    insertEmoji: (emoji, options) => {
      if (!busy && !pending.current) {
        setLoadedEmojis((current) => [
          ...current.filter((item) => item.id !== emoji.id),
          emoji,
        ]);
        const chain = editor?.chain();
        if (options?.focus !== false) chain?.focus();
        chain
          ?.insertContent({ type: "faceEmoji", attrs: { id: emoji.id } })
          .run();
      }
    },
    insertText: (text) => {
      if (!busy && !pending.current)
        editor?.chain().focus().insertContent(textContent(text)).run();
    },
    focus: () => {
      editor?.commands.focus();
    },
  }));

  useEffect(() => {
    mounted.current = true;
    const resources = assets;
    return () => {
      mounted.current = false;
      processor.current?.dispose();
      processor.current = null;
      for (const image of resources.values())
        if (image.preview.startsWith("blob:"))
          URL.revokeObjectURL(image.preview);
    };
  }, [assets]);

  return (
    <EditorEmojis.Provider value={emojiMap}>
      {emojiError ? (
        <div role="status" className="text-sm">
          {emojiError}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRetry((value) => value + 1)}
          >
            重试加载表情
          </Button>
        </div>
      ) : null}
      <EditorContent
        editor={editor}
        data-topic={topic}
        className="group/body-editor min-w-0 rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-primary/20 [[data-forum-fullscreen=true]_&]:flex [[data-forum-fullscreen=true]_&]:flex-1 [[data-forum-fullscreen=true]_&]:flex-col"
      />
    </EditorEmojis.Provider>
  );
}
