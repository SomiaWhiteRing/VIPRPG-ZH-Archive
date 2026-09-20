import type { CommentTarget } from "@/lib/comment-target";
import type { CharacterPortrait } from "@/lib/character-names";
import type { CommentImage } from "@/lib/comment-images";

import type { FaceEmoji } from "@/lib/face-emojis";
export type { FaceEmoji } from "@/lib/face-emojis";
export type CommentBodySegment =
  | { type: "text"; text: string }
  | { type: "emoji"; emoji: FaceEmoji | null };

export type CommentDto = {
  id: number;
  floorNumber: number | null;
  pinned: boolean;
  target: CommentTarget;
  rootCommentId: number | null;
  replyTo: { commentId: number; displayName: string | null } | null;
  author: {
    id: number;
    displayName: string;
    avatarBlobSha256: string | null;
  } | null;
  body: CommentBodySegment[];
  images: CommentImage[];
  bodySource?: string | null;
  status: "published" | "hidden" | "deleted";
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  likeCount: number;
  likedByMe: boolean;
  replyCount?: number;
  replyPreview?: CommentDto[];
  rootDeleted?: boolean;
};

export type CommentPage = {
  items: CommentDto[];
  nextCursor: string | null;
};

export type CommentReplyPage = {
  items: CommentDto[];
  preview: CommentDto[];
  total: number;
  page: number;
  pageSize: number;
};

export type UserCommentSummary = {
  id: number;
  target: CommentTarget;
  targetTitle: string;
  coverBlobSha256: string | null;
  avatarBlobSha256: string | null;
  portrait: CharacterPortrait | null;
  body: string;
  imageCount: number;
  status: "published" | "hidden" | "deleted";
  likeCount: number;
  updatedAt: string;
};
