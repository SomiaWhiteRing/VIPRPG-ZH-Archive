import type { CharacterPortrait } from "@/lib/character-names";

export const SEA_ROOM_LIMIT = 100;
export const SEA_ANONYMOUS_NAME = "无名的VIPPER";
export const SEA_ANONYMOUS_NAME_LIMIT = 16;
export const SEA_FACE_COUNT = 16;
export const SEA_MESSAGE_REQUEST_BYTES = 4096;
export type SeaAvatarMode = "own" | "alex";
export type SeaFont = { id: string; url: string; expiresAt: number };
export type SeaGlyph = { character: string; x: number; row: number; width: number; color?: number };
export type SeaMessage = {
  id: number;
  name: string;
  body: string;
  glyphs: SeaGlyph[];
  faceIndex: number;
  avatarUrl?: string;
  anonymous?: boolean;
  portrait?: CharacterPortrait;
  side: "left" | "right";
  createdAt: string;
};
export type SeaWindow = { revision: number; font: SeaFont; messages: SeaMessage[] };
export type SeaEvent =
  | ({ type: "snapshot" } & Omit<SeaWindow, "font">)
  | { type: "sync"; revision: number; fontId: string }
  | { type: "message"; revision: number; message: SeaMessage };
export type SeaSubmission = {
  clientMessageId: string;
  body: string;
  avatarMode: SeaAvatarMode;
  anonymousName?: string;
  faceIndex?: number;
  portrait?: Pick<CharacterPortrait, "faceSheetId" | "row" | "column">;
};
export type SeaMuteScope = "identity" | "ip";
export type SeaMute = { messageId: number; name: string; until: number; scope: SeaMuteScope; reason: string };
export type SeaModerationMessage = Omit<SeaMessage, "glyphs"> & {
  authorName: string;
  authorAvatarBlobSha256: string | null;
  guest: boolean;
  anonymous: boolean;
  hiddenAt: number | null;
  canMuteIp: boolean;
};
export type SeaModeration = {
  window: { revision: number; messages: SeaModerationMessage[] };
  mutes: SeaMute[];
  page: number;
  total: number;
};
