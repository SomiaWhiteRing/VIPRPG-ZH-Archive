export const SEA_ROOM_LIMIT = 100;
export type SeaAvatarMode = "own" | "alex";
export type SeaMessage = {
  id: number;
  name: string;
  body: string;
  faceIndex: number;
  avatarUrl?: string;
  side: "left" | "right";
  createdAt: string;
};
export type SeaWindow = { revision: number; messages: SeaMessage[] };
export type SeaEvent =
  | ({ type: "snapshot" } & SeaWindow)
  | { type: "message"; revision: number; message: SeaMessage };
export type SeaSubmission = { clientMessageId: string; body: string; avatarMode: SeaAvatarMode };
export type SeaMute = { messageId: number; name: string; until: number };
export type SeaModeration = { window: SeaWindow; mutes: SeaMute[] };
