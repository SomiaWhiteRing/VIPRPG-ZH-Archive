export const SEA_ROOM_LIMIT = 100;
export type SeaAvatarMode = "own" | "alex";
export type SeaFont = { id: string; url: string; expiresAt: number };
export type SeaGlyph = { character: string; x: number; row: number; width: number };
export type SeaMessage = {
  id: number;
  name: string;
  body: string;
  glyphs: SeaGlyph[];
  faceIndex: number;
  avatarUrl?: string;
  side: "left" | "right";
  createdAt: string;
};
export type SeaWindow = { revision: number; font: SeaFont; messages: SeaMessage[] };
export type SeaEvent =
  | ({ type: "snapshot" } & SeaWindow)
  | { type: "message"; revision: number; font: SeaFont; message: SeaMessage };
export type SeaSubmission = { clientMessageId: string; body: string; avatarMode: SeaAvatarMode };
export type SeaMute = { messageId: number; name: string; until: number };
export type SeaModerationMessage = Omit<SeaMessage, "glyphs"> & {
  authorName: string;
  authorAvatarBlobSha256: string | null;
  anonymous: boolean;
  hiddenAt: number | null;
};
export type SeaModeration = {
  window: { revision: number; messages: SeaModerationMessage[] };
  mutes: SeaMute[];
  page: number;
  total: number;
};
