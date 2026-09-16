import type { ForumImage, ForumTag, ForumTarget } from "@/lib/forum";

export type ForumAdminRow = {
  id: number;
  kind: "topic" | "post" | "comment";
  topicId: number;
  postNumber: number;
  title: string;
  body: string;
  author: string;
  state: string;
  createdAt: string;
  reportId?: number;
  reason?: string;
  explanation?: string;
  reporter?: string;
  replies?: number;
  locked?: number;
  featured?: string | null;
  tags?: string;
};

export type ForumAdminDetail = {
  images: ForumImage[];
  target: ForumTarget;
  topicRevision: string;
  title: string;
  body: string;
  state: string;
  locked: boolean;
  featured: boolean;
  publicHref: string | null;
  context: string;
  tags: string[];
  audit: {
    id: number;
    actor: string;
    event: string;
    detail: string;
    createdAt: string;
  }[];
};

export type AdminForumTag = ForumTag & {
  creator: string;
  updatedAt: string;
  affectedCount: number;
};
