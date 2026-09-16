import type { CommentTarget } from "@/lib/comment-target";

export type CommentBodySegment =
  | { type: "text"; text: string }
  | { type: "emoji"; shortcode: string; imageUrl: string; alt: string };

export type CustomEmojiDto = {
  id: number;
  shortcode: string;
  name: string;
  category: string;
  imageUrl: string;
  visibleInPicker: boolean;
  status: "active" | "retired";
};

export type CommentDto = {
  id: number;
  target: CommentTarget;
  rootCommentId: number | null;
  replyTo: { commentId: number; displayName: string | null } | null;
  author: {
    id: number;
    displayName: string;
    avatarBlobSha256: string | null;
  } | null;
  body: CommentBodySegment[];
  bodySource?: string | null;
  status: "published" | "hidden" | "deleted";
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  likeCount: number;
  likedByMe: boolean;
  replyCount?: number;
  rootDeleted?: boolean;
};

export type CommentPage = {
  items: CommentDto[];
  nextCursor: string | null;
};

export type UserCommentSummary = {
  id: number;
  target: CommentTarget;
  targetTitle: string;
  body: string;
  status: "published" | "hidden" | "deleted";
  likeCount: number;
  updatedAt: string;
};
