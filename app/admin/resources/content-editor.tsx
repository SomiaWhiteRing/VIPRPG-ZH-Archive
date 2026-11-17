import { useMessages } from "@/lib/i18n/react";
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
  const t = useMessages();
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
      role: "textbox", "aria-label": t("admin.resources.intro"), "aria-multiline": "true",
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
    } catch {
      setError(t("admin.resources.badLink"));
    }
  }
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">{t("admin.resources.intro")}</span>
      <input type="hidden" name="summaryJson" value={value} />
      <div className="rounded-md border border-border bg-card">
        <div className="flex flex-wrap gap-1 border-b border-border p-2" role="group" aria-label={t("admin.resources.format")}>
          {[
            { label: t("forum.bbcode.b"), active: "bold", run: () => editor?.chain().focus().toggleMark("bold").run() },
            { label: t("admin.resources.italic"), active: "italic", run: () => editor?.chain().focus().toggleMark("italic").run() },
            { label: t("admin.resources.underline"), active: "underline", run: () => editor?.chain().focus().toggleMark("underline").run() },
            { label: t("admin.resources.strike"), active: "strike", run: () => editor?.chain().focus().toggleMark("strike").run() },
            { label: t("admin.resources.heading"), active: "heading", run: () => editor?.chain().focus().toggleNode("heading", "paragraph").run() },
            { label: t("admin.resources.bullets"), active: "bulletList", run: () => editor?.chain().focus().toggleList("bulletList", "listItem").run() },
            { label: t("admin.resources.ordered"), active: "orderedList", run: () => editor?.chain().focus().toggleList("orderedList", "listItem").run() },
            { label: t("admin.resources.quote"), active: "blockquote", run: () => editor?.chain().focus().toggleWrap("blockquote").run() },
            { label: t("admin.resources.link"), active: "link", run: link },
          ].map(({ label, active, run }) => (
            <Button key={label} type="button" size="sm" variant={editor?.isActive(active) ? "default" : "outline"}
              aria-pressed={editor?.isActive(active) ?? false} disabled={disabled || !editor} onClick={run}>{label}</Button>
          ))}
          <Button type="button" size="sm" variant="outline" disabled={disabled || !editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>{t("character.manager.undo")}</Button>
          <Button type="button" size="sm" variant="outline" disabled={disabled || !editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>{t("admin.resources.redo")}</Button>
        </div>
        <EditorContent editor={editor} />
      </div>
      <Dialog.Root open={linkOpen} onOpenChange={setLinkOpen}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content className="left-1/2 top-1/2 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg p-6"
            onOpenAutoFocus={(event) => { event.preventDefault(); linkInput.current?.focus(); }}
            onCloseAutoFocus={(event) => { event.preventDefault(); if (!editor?.isDestroyed) editor?.commands.focus(); }}>
            <Dialog.Title>{t("admin.resources.editLink")}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted">{t("admin.resources.linkHelp")}</Dialog.Description>
            <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); applyLink(); }}>
              <div className="grid gap-2">
                <Label htmlFor={linkId}>{t("admin.resources.address")}</Label>
                <Input ref={linkInput} id={linkId} value={href} disabled={disabled} autoComplete="off" inputMode="url"
                  aria-invalid={!!error} aria-describedby={error ? `${linkId}-error` : undefined}
                  onChange={(event) => { setHref(event.target.value); setError(""); }} />
                {error ? <Notice id={`${linkId}-error`}>{error}</Notice> : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" disabled={disabled} onClick={() => applyLink(true)}>{t("admin.resources.removeLink")}</Button>
                <Dialog.Close asChild><Button type="button" variant="outline">{t("play.save.cancel")}</Button></Dialog.Close>
                <Button type="submit" disabled={disabled}>{t("admin.resources.saveLink")}</Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
