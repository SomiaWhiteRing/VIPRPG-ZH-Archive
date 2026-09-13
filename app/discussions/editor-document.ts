import type { JSONContent } from "@tiptap/core";
import { Fragment, Slice, type Node, type Schema } from "@tiptap/pm/model";
import type { DraftImage } from "./images";

// The editor owns a continuous document. Offsets are only the persistence format.
export function textContent(text: string): JSONContent[] {
  return text.split("\n").flatMap((line, index) => [
    ...(index ? [{ type: "hardBreak" }] : []),
    ...(line ? [{ type: "text", text: line }] : []),
  ]);
}

export function editorDocument(body: string, images: DraftImage[]): JSONContent {
  let offset = 0;
  const content: JSONContent[] = [];
  for (const image of images) {
    content.push(...textContent(body.slice(offset, image.offset)), imageContent(image));
    offset = image.offset;
  }
  content.push(...textContent(body.slice(offset)));
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
export function inlineSlice(slice: Slice, schema: Schema, assets: Map<string, DraftImage>) {
  const nodes: Node[] = [];
  let blocks = 0;
  slice.content.descendants((node) => {
    if (node.isTextblock && blocks++ > 0) nodes.push(schema.nodes.hardBreak.create());
    if (node.isText) nodes.push(schema.text(node.text!));
    else if (node.type.name === "hardBreak") nodes.push(schema.nodes.hardBreak.create());
    else if (node.type.name === "forumImage") {
      const image = assets.get(node.attrs.key);
      if (image) nodes.push(schema.nodeFromJSON(imageContent(image)));
    }
  });
  return new Slice(Fragment.from(nodes), 0, 0);
}
