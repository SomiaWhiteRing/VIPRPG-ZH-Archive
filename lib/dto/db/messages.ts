import type { FaceEmoji } from "@/lib/face-emojis";

export type MessagePeer = {
  id: number;
  displayName: string;
  avatarBlobSha256: string | null;
  canSend: boolean;
  receiveMessages: boolean;
  acceptsMessages: boolean;
};

export type DirectMessage = {
  id: number;
  senderUserId: number;
  kind: "text" | "image";
  body: string;
  createdAt: string;
  image: { url: string; width: number; height: number } | null;
};

export type DirectMessagePage = {
  peer: MessagePeer;
  messages: DirectMessage[];
  emojis: FaceEmoji[];
  hasOlder: boolean;
};

export type DirectConversation = {
  peer: Pick<MessagePeer, "id" | "displayName" | "avatarBlobSha256" | "receiveMessages">;
  excerpt: string;
  updatedAt: string;
  unread: number;
};
