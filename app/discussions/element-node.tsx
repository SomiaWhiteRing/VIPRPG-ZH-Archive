import { useMessages } from "@/lib/i18n/react";
import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE } from "@/lib/i18n/locale";
import { Button } from "@/app/components/ui/button";
import { forumElementToken, readForumElement } from "@/lib/forum-elements";
import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Code2, Pencil, X } from "lucide-react";
import { useState } from "react";
import { ForumElementEditor } from "./element-editor";

function ElementNodeView({ node, selected, editor, extension, updateAttributes, deleteNode }: NodeViewProps) {
  const t = useMessages();
  const [editing, setEditing] = useState(false);
  return (
    <NodeViewWrapper as="span" contentEditable={false} className="my-2 block w-fit max-w-full rounded-md border border-border bg-muted/10 p-2 data-selected:outline-2 data-selected:outline-primary" data-selected={selected || undefined}>
      <span className="inline-flex items-center gap-2 text-sm"><Code2 aria-hidden size={16} />{t("forum.element.node")}</span>
      {editor.isEditable ? (
        <span className="ml-2 inline-flex gap-1">
          {extension.options.canEdit ? <Button type="button" variant="ghost" size="icon" aria-label={t("forum.element.edit")} title={t("forum.element.edit")} onClick={() => setEditing(true)}><Pencil aria-hidden /></Button> : null}
          <Button type="button" variant="ghost" size="icon" aria-label={t("forum.element.delete")} title={t("forum.element.delete")} onClick={() => { deleteNode(); editor.commands.focus(); }}><X aria-hidden /></Button>
        </span>
      ) : null}
      {editing && editor.isEditable && extension.options.canEdit ? <ForumElementEditor source={node.attrs.source} onClose={() => setEditing(false)} onSave={(source) => { updateAttributes({ source }); setEditing(false); editor.commands.focus(); }} /> : null}
    </NodeViewWrapper>
  );
}

export const ForumElementNode = Node.create<{ canEdit: boolean; fallbackText: () => string }>({
  name: "forumElement",
  inline: true,
  group: "inline",
  atom: true,
  addOptions: () => ({
    canEdit: false,
    fallbackText: () => translate(DEFAULT_UI_LOCALE, "forum.element.placeholder"),
  }),
  addAttributes: () => ({ source: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-forum-element]", getAttrs: (element) => {
    const source = readForumElement(element.getAttribute("data-forum-element") ?? "");
    return source === null ? false : { source };
  } }],
  renderHTML({ node }) {
    return ["span", { "data-forum-element": forumElementToken(node.attrs.source) }, this.options.fallbackText()];
  },
  renderText: ({ node }) => forumElementToken(node.attrs.source),
  addNodeView: () => ReactNodeViewRenderer(ElementNodeView, { as: "span" }),
});
