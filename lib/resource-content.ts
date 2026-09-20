import { getSchema, Mark, Node, type JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import { liftListItem, sinkListItem, splitListItem } from "@tiptap/pm/schema-list";

export function resourceLink(value: string) {
  const url = new URL(value);
  if (["javascript:", "data:", "vbscript:"].includes(url.protocol))
    throw new Error("不支持此链接地址");
  return value.trim();
}

const formatting = [
  ["bold", "strong", "b", "Mod-b"],
  ["italic", "em", "i", "Mod-i"],
  ["underline", "u", "u", "Mod-u"],
  ["strike", "s", "del", "Mod-Shift-x"],
].map(([name, tag, alternate, shortcut]) => Mark.create({
  name,
  parseHTML: () => [{ tag }, { tag: alternate }],
  renderHTML: () => [tag, 0],
  addKeyboardShortcuts() {
    return { [shortcut]: () => this.editor.commands.toggleMark(name) };
  },
}));

export const resourceContentExtensions = [
  Document, Paragraph, Text, HardBreak, ...formatting,
  Mark.create({
    name: "link",
    inclusive: false,
    addAttributes: () => ({ href: { default: null } }),
    parseHTML: () => [{ tag: "a[href]", getAttrs: (element) => {
      try { resourceLink(element.getAttribute("href") ?? ""); return {}; }
      catch { return false; }
    } }],
    renderHTML: ({ HTMLAttributes }) => ["a", HTMLAttributes, 0],
  }),
  Node.create({
    name: "heading", group: "block", content: "inline*", defining: true,
    parseHTML: () => [{ tag: "h2" }, { tag: "h3" }],
    renderHTML: () => ["h3", 0],
  }),
  Node.create({
    name: "blockquote", group: "block", content: "block+", defining: true,
    parseHTML: () => [{ tag: "blockquote" }],
    renderHTML: () => ["blockquote", 0],
  }),
  ...[["bulletList", "ul"], ["orderedList", "ol"]].map(([name, tag]) => Node.create({
    name, group: "block list", content: "listItem+",
    parseHTML: () => [{ tag }],
    renderHTML: () => [tag, 0],
  })),
  Node.create({
    name: "listItem", content: "paragraph block*", defining: true,
    parseHTML: () => [{ tag: "li" }],
    renderHTML: () => ["li", 0],
    addKeyboardShortcuts() {
      const type = this.editor.schema.nodes.listItem;
      const run = (command: ReturnType<typeof splitListItem>) =>
        this.editor.commands.command(({ state, dispatch }) => command(state, dispatch));
      return {
        Enter: () => run(splitListItem(type)),
        Tab: () => run(sinkListItem(type)),
        "Shift-Tab": () => run(liftListItem(type)),
      };
    },
  }),
];

const schema = getSchema(resourceContentExtensions);
export function parseResourceContent(value: string): JSONContent {
  const node = schema.nodeFromJSON(JSON.parse(value));
  if (node.type !== schema.topNodeType) throw new Error("介绍格式不正确");
  node.check();
  node.descendants((child) => {
    for (const mark of child.marks) {
      if (mark.type.name === "link") {
        if (typeof mark.attrs.href !== "string") throw new Error("链接格式不正确");
        resourceLink(mark.attrs.href);
      }
    }
  });
  return node.toJSON();
}
