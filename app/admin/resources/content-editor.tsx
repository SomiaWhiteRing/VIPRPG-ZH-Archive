import { useEffect, useId, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { UndoRedo } from "@tiptap/extensions";
import { Button } from "@/app/components/ui/button";
import { resourceContentClassName } from "@/lib/resources";
import { Notice } from "@/app/components/ui/notice";
import * as Dialog from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import {
  resourceContentExtensions, resourceLink,
} from "@/lib/resource-content";

export function ResourceContentEditor({ initial, disabled }: {
  initial: string;
  disabled: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const selection = useRef<{ from: number; to: number } | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const linkId = useId();
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [...resourceContentExtensions, UndoRedo],
    content: JSON.parse(initial),
    onUpdate: ({ editor }) => setValue(JSON.stringify(editor.getJSON())),
    editorProps: { attributes: {
      role: "textbox", "aria-label": "卡片介绍", "aria-multiline": "true",
      class: `${resourceContentClassName} min-h-40 p-3 outline-none`,
    } },
  });
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  function link() {
    if (!editor || disabled) return;
    selection.current = { from: editor.state.selection.from, to: editor.state.selection.to };
    setHref(editor.getAttributes("link").href ?? "");
    setError("");
    setLinkOpen(true);
  }
  function applyLink(remove = false) {
    if (!editor || disabled || !selection.current) return;
    try {
      const url = remove || !href.trim() ? null : resourceLink(href);
      setError("");
      const chain = editor.chain().setTextSelection(selection.current).extendMarkRange("link");
      if (url) chain.setMark("link", { href: url }).run();
      else chain.unsetMark("link").run();
      setLinkOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "链接格式不正确");
    }
  }
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">卡片介绍</span>
      <input type="hidden" name="summaryJson" value={value} />
      <div className="rounded-md border border-border bg-card">
        <div className="flex flex-wrap gap-1 border-b border-border p-2" role="group" aria-label="文字格式">
          {[
            { label: "粗体", active: "bold", run: () => editor?.chain().focus().toggleMark("bold").run() },
            { label: "斜体", active: "italic", run: () => editor?.chain().focus().toggleMark("italic").run() },
            { label: "下划线", active: "underline", run: () => editor?.chain().focus().toggleMark("underline").run() },
            { label: "删除线", active: "strike", run: () => editor?.chain().focus().toggleMark("strike").run() },
            { label: "标题", active: "heading", run: () => editor?.chain().focus().toggleNode("heading", "paragraph").run() },
            { label: "无序列表", active: "bulletList", run: () => editor?.chain().focus().toggleList("bulletList", "listItem").run() },
            { label: "有序列表", active: "orderedList", run: () => editor?.chain().focus().toggleList("orderedList", "listItem").run() },
            { label: "引用", active: "blockquote", run: () => editor?.chain().focus().toggleWrap("blockquote").run() },
            { label: "链接", active: "link", run: link },
          ].map(({ label, active, run }) => (
            <Button key={label} type="button" size="sm" variant={editor?.isActive(active) ? "default" : "outline"}
              aria-pressed={editor?.isActive(active) ?? false} disabled={disabled || !editor} onClick={run}>{label}</Button>
          ))}
          <Button type="button" size="sm" variant="outline" disabled={disabled || !editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>撤销</Button>
          <Button type="button" size="sm" variant="outline" disabled={disabled || !editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>重做</Button>
        </div>
        <EditorContent editor={editor} />
      </div>
      <Dialog.Root open={linkOpen} onOpenChange={setLinkOpen}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content className="left-1/2 top-1/2 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg p-6"
            onOpenAutoFocus={(event) => { event.preventDefault(); linkInput.current?.focus(); }}
            onCloseAutoFocus={(event) => { event.preventDefault(); if (!editor?.isDestroyed) editor?.commands.focus(); }}>
            <Dialog.Title>编辑链接</Dialog.Title>
            <Dialog.Description className="text-sm text-muted">为选中的文字设置链接。留空保存或选择“移除链接”，会保留文字并移除链接。</Dialog.Description>
            <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); applyLink(); }}>
              <div className="grid gap-2">
                <Label htmlFor={linkId}>链接地址</Label>
                <Input ref={linkInput} id={linkId} value={href} disabled={disabled} autoComplete="off" inputMode="url"
                  aria-invalid={!!error} aria-describedby={error ? `${linkId}-error` : undefined}
                  onChange={(event) => { setHref(event.target.value); setError(""); }} />
                {error ? <Notice id={`${linkId}-error`}>{error}</Notice> : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" disabled={disabled} onClick={() => applyLink(true)}>移除链接</Button>
                <Dialog.Close asChild><Button type="button" variant="outline">取消</Button></Dialog.Close>
                <Button type="submit" disabled={disabled}>保存链接</Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
