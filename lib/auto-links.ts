// Conservative ASCII URL boundaries keep adjacent prose and editor tokens out.
// Non-ASCII URL components can be pasted in their percent-encoded / punycode form.
export const AUTO_LINK_PATTERN = /https?:\/\/(?:(?!:face_[1-9]\d{0,15}:|@\[)[A-Za-z0-9._~:/?#@!$&()*+,;=%[\]-])+/g;
const FULL_LINK_PATTERN = new RegExp(`^(?:${AUTO_LINK_PATTERN.source})$`);

export function autoLink(candidate: string) {
  if (!FULL_LINK_PATTERN.test(candidate)) return null;
  let text = candidate;
  for (;;) {
    const previous = text;
    text = text.replace(/[.,;:!?]+$/, "");
    for (const [open, close] of [["(", ")"], ["[", "]"]]) {
      const count = (character: string) => text.split(character).length - 1;
      while (text.endsWith(close) && count(close) > count(open)) text = text.slice(0, -1);
    }
    if (text === previous) break;
  }
  try {
    const url = new URL(text);
    if (!url.hostname || url.username || url.password) return null;
    return { text, href: url.href, suffix: candidate.slice(text.length) };
  } catch { return null; }
}
