import { createContext, useContext } from "react";
import { Node } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { emojiToken, type FaceEmoji } from "@/lib/face-emojis";
import { FaceEmojiView } from "./face-emoji";
export const EditorEmojis = createContext<ReadonlyMap<number, FaceEmoji>>(
  new Map(),
);
function EmojiNodeView({ node, selected }: NodeViewProps) {
  const emojis = useContext(EditorEmojis);
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      className={`inline-flex align-middle ${selected ? "outline-2 outline-primary" : ""}`}
    >
      <FaceEmojiView
        key={node.attrs.id}
        emoji={emojis.get(node.attrs.id) ?? null}
      />
    </NodeViewWrapper>
  );
}
export const FaceEmojiNode = Node.create({
  name: "faceEmoji",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  addAttributes: () => ({ id: { default: 0 } }),
  parseHTML: () => [
    {
      tag: "span[data-face-emoji]",
      getAttrs: (element) => {
        const id = Number(element.getAttribute("data-face-emoji"));
        return Number.isSafeInteger(id) && id > 0 ? { id } : false;
      },
    },
  ],
  renderHTML: ({ node }) => [
    "span",
    { "data-face-emoji": node.attrs.id },
    emojiToken(node.attrs.id),
  ],
  renderText: ({ node }) => emojiToken(node.attrs.id),
  addNodeView: () => ReactNodeViewRenderer(EmojiNodeView, { as: "span" }),
});
