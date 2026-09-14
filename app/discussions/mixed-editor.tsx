"use client";

import Image from "next/image";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Node as TiptapNode, Extension } from "@tiptap/core";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import { Dropcursor, Placeholder, UndoRedo } from "@tiptap/extensions";
import { Fragment, Slice } from "@tiptap/pm/model";
import { Plugin, type SelectionBookmark } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { FORUM_BODY_LENGTH, FORUM_POST_BODY_LENGTH, FORUM_IMAGE_COUNT } from "@/lib/forum";
import { selectDraftImages, cloneDraftImage, type DraftImage } from "./images";
import { editorDocument, imageContent, inlineSlice, readDocument, textContent } from "./editor-document";
import styles from "./mixed-editor.module.css";
import { createImageProcessor } from "./image-processor";

export type MixedEditorHandle = {
  insertFiles: (files: File[]) => void;
  insertText: (text: string) => void;
  focus: () => void;
};

function ImageNode({ node, selected, editor, deleteNode }: NodeViewProps) {
  return (
    <NodeViewWrapper as="span" className={styles.image} contentEditable={false} data-selected={selected || undefined}>
      <Image src={node.attrs.src} alt="正文图片" width={640} height={360} unoptimized draggable data-drag-handle className={styles.preview} />
      {selected && editor.isEditable ? (
        <Button type="button" size="icon" variant="secondary" className={styles.remove} aria-label="删除选中图片" title="删除图片"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { if (editor.isEditable) { deleteNode(); editor.commands.focus(); } }}><X /></Button>
      ) : null}
      {node.attrs.error ? <span role="alert" className="block text-sm text-destructive">{node.attrs.error}</span> : null}
    </NodeViewWrapper>
  );
}

const ForumImageNode = TiptapNode.create({
  name: "forumImage",
  inline: true,
  group: "inline",
  atom: true,
  draggable: true,
  addAttributes: () => ({ key: { default: null }, src: { default: null }, error: { default: null, rendered: false } }),
  parseHTML: () => [{ tag: "img[data-forum-image]", getAttrs: (element) => ({ key: element.getAttribute("data-forum-image") }) }],
  renderHTML: ({ node }) => ["img", { "data-forum-image": node.attrs.key, src: node.attrs.src, alt: "正文图片" }],
  addNodeView: () => ReactNodeViewRenderer(ImageNode, { as: "span" }),
});

export function MixedEditor({ body, images, busy, topic, onChange, onBusyChange, onError, onCompositionChange, ref }: {
  body: string;
  images: DraftImage[];
  busy: boolean;
  topic: boolean;
  onChange: (body: string, images: DraftImage[]) => void;
  onBusyChange: (value: boolean) => void;
  onError: (message: string) => void;
  onCompositionChange: (value: boolean) => void;
  ref?: Ref<MixedEditorHandle>;
}) {
  // Keep resources removed by editing alive for undo/redo until the draft ends.
  const [assets] = useState(() => new Map(images.map((image) => [image.key, image])));
  const processor = useRef<ReturnType<typeof createImageProcessor> | null>(null);
  const mounted = useRef(true);
  const pending = useRef<{ bookmark: SelectionBookmark } | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      Document.extend({ content: "paragraph" }),
      Paragraph.extend({
        addKeyboardShortcuts() { return { Enter: () => this.editor.commands.setHardBreak() }; },
      }),
      Text, HardBreak, ForumImageNode, UndoRedo,
      Dropcursor.configure({ color: "var(--color-primary)", width: 2 }),
      Placeholder.configure({ placeholder: "写下正文……" }),
      Extension.create({
        name: "forumLimits",
        addProseMirrorPlugins() {
          return [new Plugin({
            filterTransaction(transaction) {
              if (!transaction.docChanged) return true;
              const value = readDocument(transaction.doc, assets);
              return value.body.length <= (topic ? FORUM_BODY_LENGTH : FORUM_POST_BODY_LENGTH) && value.images.length<=FORUM_IMAGE_COUNT &&
                new Set(value.images.map((image) => image.key)).size === value.images.length;
            },
          })];
        },
      }),
    ],
    content: editorDocument(body, images),
    editorProps: {
      attributes: { id: "forum-body", role: "textbox", "aria-label": "正文", "aria-multiline": "true", class: styles.document },
      handleDOMEvents: {
        compositionstart: () => { onCompositionChange(true); return false; },
        compositionend: () => { onCompositionChange(false); return false; },
      },
      transformPasted: (slice, view) => inlineSlice(slice, view.state.schema, assets),
      clipboardTextSerializer: (slice) => slice.content.textBetween(0, slice.content.size, "\n", (node) => node.type.name === "hardBreak" ? "\n" : ""),
      handlePaste: (_view, event, slice) => {
        if (busy || pending.current) return true;
        const files = Array.from(event.clipboardData?.files ?? []);
        // Internal HTML represents an editable slice, even if the browser also provides a file.
        if (slice.content.content.some((node) => node.type.name === "forumImage")) void insertSlice(slice);
        else if (files.length) void insertFiles(files);
        else return false;
        return true;
      },
      handleDrop: (view, event, slice, moved) => {
        if (busy || pending.current) return true;
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        const point = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (point) editor?.commands.setTextSelection(point.pos);
        if (files.length) void insertFiles(files);
        else void insertSlice(inlineSlice(slice, view.state.schema, assets));
        return true;
      },
    },
    onTransaction: ({ transaction }) => {
      if (pending.current) pending.current.bookmark = pending.current.bookmark.map(transaction.mapping);
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
    if (current.body !== body || JSON.stringify(current.images.map((image) => [image.key, image.offset])) !== JSON.stringify(images.map((image) => [image.key, image.offset]))) {
      editor.commands.setContent(editorDocument(body, images), { emitUpdate: false });
    } else {
      const transaction = editor.state.tr;
      transaction.doc.descendants((node, pos) => {
        if (node.type.name !== "forumImage") return;
        const image = assets.get(node.attrs.key);
        if (image && (node.attrs.src !== image.preview || node.attrs.error !== (image.error ?? null)))
          transaction.setNodeMarkup(pos, undefined, imageContent(image).attrs);
      });
      if (transaction.docChanged) editor.view.dispatch(transaction.setMeta("addToHistory", false).setMeta("preventUpdate", true));
    }
  }, [editor, body, images, assets]);
  useEffect(() => { editor?.setEditable(!busy, false); }, [editor, busy]);
  useEffect(() => { if (editor && !topic) editor.commands.focus("end"); }, [editor, topic]);

  async function insert(content: (current: DraftImage[]) => Promise<Slice>) {
    if (!editor || editor.isDestroyed || busy || pending.current) return;
    pending.current = { bookmark: editor.state.selection.getBookmark() };
    onBusyChange(true);
    onError("");
    try {
      const { from, to } = editor.state.selection;
      const remaining: DraftImage[] = [];
      editor.state.doc.descendants((node, pos) => {
        const image = node.type.name === "forumImage" ? assets.get(node.attrs.key) : undefined;
        if (image && (pos < from || pos >= to)) remaining.push(image);
      });
      const slice = await content(remaining);
      if (!mounted.current || editor.isDestroyed) return;
      const transaction = closeHistory(editor.state.tr);
      transaction.setSelection(pending.current.bookmark.resolve(transaction.doc));
      transaction.replaceSelection(slice).scrollIntoView();
      const result = readDocument(transaction.doc, assets);
      if (result.body.length > FORUM_BODY_LENGTH)
        throw new Error("正文超过单帖限制，请减少后再插入。");
      editor.view.dispatch(transaction);
      editor.view.dispatch(closeHistory(editor.state.tr));
      requestAnimationFrame(() => { if (!editor.isDestroyed) editor.commands.focus(); });
    } catch (error) {
      if (mounted.current) onError(error instanceof Error ? error.message : "图片插入失败。");
    } finally {
      pending.current = null;
      if (mounted.current) onBusyChange(false);
    }
  }
  function insertFiles(files: File[]) {
    if (!files.length) return;
    return insert(async () => {
      processor.current ??= createImageProcessor();
      if(readDocument(editor!.state.doc,assets).images.length+files.length>FORUM_IMAGE_COUNT)throw new Error("每帖最多 10 张图片。");
      const added = await selectDraftImages(files, processor.current.process);
      if (!mounted.current) {
        for (const image of added) URL.revokeObjectURL(image.preview);
        throw new Error("图片处理已取消。");
      }
      for (const image of added) assets.set(image.key, image);
      return new Slice(Fragment.from(added.map((image) => editor!.schema.nodeFromJSON(imageContent(image)))), 0, 0);
    });
  }
  function insertSlice(slice: Slice) {
    return insert(async () => {
      const { from, to } = editor!.state.selection;
      const present = new Set<string>();
      editor!.state.doc.descendants((node, pos) => {
        if (node.type.name === "forumImage" && (pos < from || pos >= to)) present.add(node.attrs.key);
      });
      const nodes = [];
      for (const node of slice.content.content) {
        const source = node.type.name === "forumImage" ? assets.get(node.attrs.key) : undefined;
        if (!source || !present.has(source.key)) {
          nodes.push(node);
          if (source) present.add(source.key);
          continue;
        }
        // A second occurrence gets its own upload identity under the existing one-image/one-slot contract.
        let file = source.file;
        if (!file) {
          const response = await fetch(source.preview, { signal: AbortSignal.timeout(15000), credentials: "same-origin" });
          if (!response.ok) throw new Error("图片暂时无法复制，请稍后重试。");
          file = new File([await response.blob()], "image", { type: `image/${source.uploaded!.format}` });
        }
        const copy = await cloneDraftImage(file);
        if (!mounted.current) { URL.revokeObjectURL(copy.preview); throw new Error("图片处理已取消。"); }
        assets.set(copy.key, copy);
        nodes.push(editor!.schema.nodeFromJSON(imageContent(copy)));
        present.add(copy.key);
      }
      return new Slice(Fragment.from(nodes), 0, 0);
    });
  }
  useImperativeHandle(ref, () => ({
    insertFiles: (files) => { void insertFiles(files); },
    insertText: (text) => { if (!busy && !pending.current) editor?.chain().focus().insertContent(textContent(text)).run(); },
    focus: () => { editor?.commands.focus(); },
  }));

  useEffect(() => {
    mounted.current = true;
    const resources = assets;
    return () => { mounted.current = false; processor.current?.dispose(); processor.current = null; for (const image of resources.values()) if (image.preview.startsWith("blob:")) URL.revokeObjectURL(image.preview); };
  }, [assets]);

  return <EditorContent editor={editor} className={`${styles.editor} ${topic ? styles.topic : ""} rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-primary/20`} />;
}
