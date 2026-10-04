import { MENTION_PATTERN, mentionToken, readMention } from "@/lib/mentions";
import { FACE_EMOJI_PATTERN, emojiToken } from "@/lib/face-emojis";
import type { JSONContent } from "@tiptap/core";
import { Fragment, Slice, type Node, type Schema } from "@tiptap/pm/model";
import type { DraftImage } from "./images";

// The editor owns a continuous document. Offsets are only the persistence format.
export function textContent(text: string, allowMentions = true): JSONContent[] {
  const content: JSONContent[] = [];
  const plain = (value: string) =>
    value.split("\n").forEach((line, index) => {
      if (index) content.push({ type: "hardBreak" });
      if (line) content.push({ type: "text", text: line });
    });
  let cursor = 0;
  for (const match of text.matchAll(new RegExp(`${MENTION_PATTERN.source}|${FACE_EMOJI_PATTERN.source}`, "g"))) {
    plain(text.slice(cursor, match.index));
    const user = readMention(match[0]);
    if (user && allowMentions) content.push({ type: "userMention", attrs: user });
    else if (match[0].startsWith(":face_")) content.push({ type: "faceEmoji", attrs: { id: Number(match[3]) } });
    else plain(match[0]);
    cursor = match.index + match[0].length;
  }
  plain(text.slice(cursor));
  return content;
}

export function editorDocument(
  body: string,
  images: DraftImage[],
  allowMentions = true,
): JSONContent {
  let offset = 0;
  const content: JSONContent[] = [];
  for (const image of images) {
    content.push(
      ...textContent(body.slice(offset, image.offset), allowMentions),
      imageContent(image),
    );
    offset = image.offset;
  }
  content.push(...textContent(body.slice(offset), allowMentions));
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

export function imageContent(image: DraftImage): JSONContent {
  return {
    type: "forumImage",
    attrs: { key: image.key, src: image.preview, error: image.error ?? null },
  };
}

export function readDocument(doc: Node, assets: Map<string, DraftImage>) {
  let body = "";
  const images: DraftImage[] = [];
  doc.descendants((node) => {
    if (node.isText) body += node.text;
    else if (node.type.name === "userMention") body += mentionToken({ id: node.attrs.id, displayName: node.attrs.displayName });
    else if (node.type.name === "faceEmoji") body += emojiToken(node.attrs.id);
    else if (node.type.name === "hardBreak") body += "\n";
    else if (node.type.name === "forumImage") {
      const image = assets.get(node.attrs.key);
      if (image) images.push({ ...image, offset: body.length });
    }
  });
  return { body, images };
}

// Flatten pasted paragraphs into line breaks; retain only known local image nodes.
// Pasted HTML cannot supply remote URLs, upload IDs, or arbitrary rich text.
export function inlineSlice(
  slice: Slice,
  schema: Schema,
  assets: Map<string, DraftImage>,
) {
  const nodes: Node[] = [];
  let blocks = 0;
  slice.content.descendants((node) => {
    if (node.isTextblock && blocks++ > 0)
      nodes.push(schema.nodes.hardBreak.create());
    if (node.isText)
      nodes.push(
        ...textContent(node.text!, !!schema.nodes.userMention).map((item) => schema.nodeFromJSON(item)),
      );
    else if (node.type.name === "userMention")
      nodes.push(schema.nodes.userMention ? schema.nodes.userMention.create(node.attrs) : schema.text(mentionToken({ id: node.attrs.id, displayName: node.attrs.displayName })));
    else if (node.type.name === "faceEmoji")
      nodes.push(schema.nodes.faceEmoji.create({ id: node.attrs.id }));
    else if (node.type.name === "hardBreak")
      nodes.push(schema.nodes.hardBreak.create());
    else if (node.type.name === "forumImage") {
      const image = assets.get(node.attrs.key);
      if (image && schema.nodes.forumImage) nodes.push(schema.nodeFromJSON(imageContent(image)));
    }
  });
  return new Slice(Fragment.from(nodes), 0, 0);
}
