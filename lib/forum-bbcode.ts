import { FACE_EMOJI_PATTERN } from "./face-emojis";
import { FORUM_ELEMENT_PATTERN } from "./forum-elements";
import { MENTION_PATTERN } from "./mentions";

export const FORUM_BBCODES = [
  { tag: "b", label: "粗体" },
  { tag: "del", label: "删除线" },
  { tag: "size", label: "字号", parameter: "120%" },
  { tag: "quote", label: "引用" },
  { tag: "code", label: "代码" },
  { tag: "collapse", label: "折叠" },
  { tag: "dice", label: "骰子", sample: "d100", sampleSelectionStart: 1 },
] as const;
export type ForumBBCodeTag = (typeof FORUM_BBCODES)[number]["tag"] | "i" | "u";
export type ForumBBCodeNode =
  | { type: "text"; text: string }
  | { type: "image"; index: number }
  | { type: ForumBBCodeTag; parameter?: string; children: ForumBBCodeNode[] };

// Parse once across image boundaries, keeping mentions and executable-element
// tokens opaque. Unknown, mismatched and unclosed tags remain readable text.
export function parseForumBBCode(body: string, imageOffsets: number[] = []): ForumBBCodeNode[] {
  type Frame = { type: ForumBBCodeTag; parameter?: string; opening: string; children: ForumBBCodeNode[] };
  const root: ForumBBCodeNode[] = [];
  const stack: Frame[] = [];
  const current = () => stack.at(-1)?.children ?? root;
  const text = (value: string) => {
    if (!value) return;
    const nodes = current();
    const last = nodes.at(-1);
    if (last?.type === "text") last.text += value;
    else nodes.push({ type: "text", text: value });
  };
  let imageIndex = 0;
  function plain(start: number, end: number) {
    while (imageIndex < imageOffsets.length && imageOffsets[imageIndex] <= end) {
      const offset = Math.max(start, imageOffsets[imageIndex]);
      text(body.slice(start, offset));
      current().push({ type: "image", index: imageIndex++ });
      start = offset;
    }
    text(body.slice(start, end));
  }
  const tokens = new RegExp(`${MENTION_PATTERN.source}|${FACE_EMOJI_PATTERN.source}|${FORUM_ELEMENT_PATTERN.source}|\\[(/?)(b|i|u|del|size|quote|code|collapse|dice)(?:=([^\\]\\r\\n]{1,120}))?\\]`, "gi");
  let cursor = 0;
  for (const match of body.matchAll(tokens)) {
    plain(cursor, match.index);
    const end = match.index + match[0].length;
    const tag = /^\[(\/?)(b|i|u|del|size|quote|code|collapse|dice)(?:=([^\]\r\n]{1,120}))?\]$/i.exec(match[0]);
    const type = tag?.[2].toLowerCase() as ForumBBCodeTag | undefined;
    const closing = tag?.[1] === "/";
    const literal = !type || (tag?.[3] !== undefined && (!["collapse", "size"].includes(type) || closing)) ||
      (type === "size" && !closing && !/^(?:[5-9]\d|1\d\d|200)%$/.test(tag?.[3] ?? "")) ||
      (["code", "dice"].includes(stack.at(-1)?.type ?? "") && !(type === stack.at(-1)?.type && closing)) ||
      imageOffsets.some((offset) => offset > match.index && offset < end);
    if (literal) plain(match.index, end);
    else if (closing) {
      if (stack.at(-1)?.type === type) {
        const node = stack.pop()!;
        current().push({ type: node.type, parameter: node.parameter, children: node.children });
      } else text(match[0]);
    } else if (stack.length < 24) {
      stack.push({ type, parameter: tag?.[3], opening: match[0], children: [] });
    } else text(match[0]);
    cursor = end;
  }
  plain(cursor, body.length);
  while (stack.length) {
    const node = stack.pop()!;
    text(node.opening);
    current().push(...node.children);
  }
  return root;
}

// Entertainment rolls are reproducible from the persisted post identity, dice
// ordinal and expression. No browser randomness or extra database state is used.
export function forumDice(expression: string, postKey: string, ordinal: number) {
  const match = /^(\d{0,3})d(\d{1,7})([+-]\d{1,7})?$/i.exec(expression.trim());
  if (!match || !/^[1-9]\d*\/[1-9]\d*$/.test(postKey)) return null;
  const count = Number(match[1] || 1), sides = Number(match[2]), modifier = Number(match[3] || 0);
  if (count < 1 || count > 100 || sides < 2 || sides > 1_000_000 || Math.abs(modifier) > 1_000_000) return null;
  const notation = `${count === 1 ? "" : count}d${sides}${modifier ? `${modifier > 0 ? "+" : ""}${modifier}` : ""}`;
  let seed = 2166136261;
  for (const character of `${postKey}:${ordinal}:${notation}`)
    seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const rolls = Array.from({ length: count }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor(seed / 4294967296 * sides) + 1;
  });
  const total = rolls.reduce((sum, value) => sum + value, modifier);
  const calculation = count > 1 || modifier
    ? `${rolls.join(" + ")}${modifier ? ` ${modifier > 0 ? "+" : "−"} ${Math.abs(modifier)}` : ""} = ${total}`
    : String(total);
  return { notation, rolls, total, calculation };
}
