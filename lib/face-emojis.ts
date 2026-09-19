import type { CharacterPortrait } from "@/lib/character-names";

export type FaceEmojiCell = { blobSha256: string; row: number; column: number };
export type FaceEmoji = FaceEmojiCell & {
  id: number;
  width: number;
  height: number;
  available: boolean;
  sources: { id: number; name: string }[];
  users?: number;
};
export type EmojiCharacter = {
  id: number;
  name: string;
  originalName: string;
  defaultPortrait?: CharacterPortrait | null;
  categoryIds?: string[];
  sortOrder?: number;
};
export type EmojiCategory = {
  id: string;
  parentId: string | null;
  label: string;
  sortOrder: number;
};
export type EmojiSheet = {
  id: number;
  blobSha256: string;
  width: number;
  height: number;
};

export const FACE_EMOJI_PATTERN = /:face_([1-9]\d{0,15}):/g;
export function emojiToken(id: number): string {
  return `:face_${id}:`;
}
export function emojiIds(body: string): number[] {
  return [
    ...new Set(
      [...body.matchAll(FACE_EMOJI_PATTERN)]
        .map((match) => Number(match[1]))
        .filter(Number.isSafeInteger),
    ),
  ];
}
export function emojiText(body: string): string {
  return body.replace(FACE_EMOJI_PATTERN, "[表情]");
}
export function bodyLength(body: string): number {
  return [...body.replace(FACE_EMOJI_PATTERN, "\ufffc")].length;
}
export function emojiCellKey(cell: FaceEmojiCell): string {
  return `${cell.blobSha256}:${cell.row}:${cell.column}`;
}
