import { createElement, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/core";
import { resourceContentClassName } from "@/lib/resources";

const tags: Record<string, string> = {
  paragraph: "p", heading: "h3", blockquote: "blockquote",
  bulletList: "ul", orderedList: "ol", listItem: "li",
  bold: "strong", italic: "em", underline: "u", strike: "s",
};
function render(node: JSONContent, key: number): ReactNode {
  if (node.type === "text") {
    let content: ReactNode = node.text;
    for (const mark of node.marks ?? []) {
      if (mark.type === "link") content = <a href={mark.attrs?.href}>{content}</a>;
      else if (tags[mark.type]) content = createElement(tags[mark.type], null, content);
    }
    return <span key={key}>{content}</span>;
  }
  if (node.type === "hardBreak") return <br key={key} />;
  return createElement(tags[node.type ?? ""] ?? "div", { key }, node.content?.map(render));
}
export function ResourceContent({ value }: { value: string }) {
  const doc: JSONContent = JSON.parse(value);
  return <div className={resourceContentClassName}>{doc.content?.map(render)}</div>;
}
