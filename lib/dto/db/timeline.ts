import type { FaceEmoji } from "@/lib/face-emojis";
import type { CommentImage } from "@/lib/comment-images";
export const TIMELINE_RECORD_KINDS = ["favorite", "catalog", "comment", "discussion", "upload", "play"] as const;
export type TimelineRecordKind = (typeof TIMELINE_RECORD_KINDS)[number];
export const TIMELINE_FILTER_KINDS = [...TIMELINE_RECORD_KINDS, "status"] as const;
export const TIMELINE_KINDS = [...TIMELINE_FILTER_KINDS, "join", "rename"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];
export type TimelineView = "all" | "mine" | "following";
export type TimelineDefaultView = "all" | "following";
export function isTimelineDefaultView(value: unknown): value is TimelineDefaultView {
  return value === "all" || value === "following";
}
export function isTimelineView(value: unknown): value is TimelineView {
  return value === "all" || value === "mine" || value === "following";
}
export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  favorite: "收藏", catalog: "目录", comment: "评论",
  discussion: "发帖", upload: "上传", play: "游玩", status: "吐槽", join: "加入", rename: "改名",
};
export type TimelineSettings = { enabled: boolean; recordKinds: TimelineRecordKind[]; timelineAsHomepage: boolean; defaultView: TimelineDefaultView };
export function isTimelineRecordKind(value: unknown): value is TimelineRecordKind {
  return typeof value === "string" && (TIMELINE_RECORD_KINDS as readonly string[]).includes(value);
}
export type TimelineWork = {
  id: number;
  title: string;
  originalTitle: string;
  coverBlobSha256: string | null;
  genre: string | null;
  engineFamily: string;
};
export type TimelineItem = {
  id: number;
  kind: TimelineKind;
  action: string;
  createdAt: string;
  updatedAt: string;
  actor: { id: number; displayName: string; avatarBlobSha256: string | null };
  text: string;
  target: { title: string; href: string } | null;
  work: TimelineWork | null;
  sourceReplyCount: number | null;
  canDelete: boolean;
  body: TimelineBodySegment[];
  nameChange: { previousName: string; newName: string } | null;
  images: CommentImage[];
  likeCount: number;
  replyCount: number;
  likedByMe: boolean;
  canLike: boolean;
  canReply: boolean;
};
export type TimelineBodySegment = { type: "text"; text: string } | { type: "emoji"; emoji: FaceEmoji | null };
export type TimelineReply = {
  id: number;
  actor: TimelineItem["actor"];
  body: TimelineBodySegment[];
  images: CommentImage[];
  createdAt: string;
  canDelete: boolean;
};
export type TimelineReplyPage = { items: TimelineReply[]; nextCursor: number | null };
export type TimelinePage = { items: TimelineItem[]; nextCursor: string | null };
export function isTimelineKind(value: unknown): value is TimelineKind {
  return typeof value === "string" && (TIMELINE_KINDS as readonly string[]).includes(value);
}
