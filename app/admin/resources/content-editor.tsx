import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { UndoRedo } from "@tiptap/extensions";
import { Button } from "@/app/components/ui/button";
import { resourceContentClassName } from "@/lib/resources";
import { Notice } from "@/app/components/ui/notice";
import {
  resourceContentExtensions, resourceLink,
} from "@/lib/resource-content";

export function ResourceContentEditor({ initial, disabled }: {
  initial: string;
  disabled: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
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
    if (!editor) return;
    const href = window.prompt("链接地址（留空移除链接）", editor.getAttributes("link").href ?? "");
    if (href === null) return;
    try {
      setError("");
      const chain = editor.chain().focus().extendMarkRange("link");
      if (href.trim()) chain.setMark("link", { href: resourceLink(href) }).run();
      else chain.unsetMark("link").run();
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
      {error ? <Notice>{error}</Notice> : null}
    </div>
  );
}
