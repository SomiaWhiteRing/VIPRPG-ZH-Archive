const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });

export function normalizeForumSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function textBoundaries(text: string): number[] {
  return [0, ...Array.from(segmenter.segment(text), ({ index, segment }) => index + segment.length)];
}

// Match the whole normalized string, then map back to original grapheme edges.
// Prefix lengths handle expansion (ﬃ), composition (e + ◌́), and normalization
// across graphemes (compatibility Hangul) without normalizing each character alone.
export function* forumSearchMatches(text: string, query: string) {
  const needle = normalizeForumSearch(query).trim();
  if (!needle) return;
  const normalized = normalizeForumSearch(text);
  let index = normalized.indexOf(needle);
  if (index < 0) return;
  const boundaries = textBoundaries(text);
  const lengths = new Map<number, number>([[0, 0], [boundaries.length - 1, normalized.length]]);
  function prefixLength(boundary: number): number {
    let length = lengths.get(boundary);
    if (length === undefined) {
      length = normalizeForumSearch(text.slice(0, boundaries[boundary])).length;
      lengths.set(boundary, length);
    }
    return length;
  }
  function originalOffset(offset: number, end: boolean): number {
    let low = 0, high = boundaries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (prefixLength(middle) <= offset) low = middle + 1;
      else high = middle;
    }
    const before = low - 1;
    return boundaries[end && prefixLength(before) < offset ? low : before];
  }
  while (index >= 0) {
    yield {
      start: originalOffset(index, false),
      end: originalOffset(index + needle.length, true),
    };
    index = normalized.indexOf(needle, index + needle.length);
  }
}

export function forumSearchSnippet(text: string, query: string): string {
  const first = forumSearchMatches(text, query).next();
  const match = first.done ? undefined : first.value;
  const desiredStart = Math.max(0, (match?.start ?? 0) - 40);
  const desiredEnd = Math.max(desiredStart + 180, match?.end ?? 0);
  const boundaries = textBoundaries(text);
  let start = 0;
  for (const offset of boundaries) {
    if (offset > desiredStart) break;
    start = offset;
  }
  const end = boundaries.find((offset) => offset >= desiredEnd) ?? text.length;
  return (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
