import type { ForumEditVersion, ForumTarget } from "@/lib/forum";
import type { DraftImage } from "./images";

export type ForumDraft = {
  cacheKey?: string;
  collapsed?: boolean;
  editorId: string;
  mode: "topic" | "post" | "comment";
  target?: ForumTarget;
  postId?: number;
  postNumber?: number;
  replyToId?: number;
  replyName?: string;
  title: string;
  body: string;
  images: DraftImage[];
  tags: string[];
  original: ForumDraftSnapshot;
  revision?: string;
  topicRevision?: string;
  requestKey: string;
  currentVersion?: ForumEditVersion;
};

type ForumDraftSnapshot = {
  title: string;
  body: string;
  tags: string[];
  replyToId?: number;
  images: { key: string; offset: number }[];
};

export function draftSnapshot(draft: ForumDraftSnapshot): ForumDraftSnapshot {
  return {
    title: draft.title,
    body: draft.body,
    tags: [...draft.tags],
    replyToId: draft.replyToId,
    images: draft.images.map(({ key, offset }) => ({ key, offset })),
  };
}

export function draftValue(draft: ForumDraftSnapshot) {
  return JSON.stringify(draftSnapshot(draft));
}

export const forumReplyLauncherClass =
  "flex min-h-10 w-full items-center justify-start gap-2 font-normal rounded-md border border-border bg-muted/10 px-3 py-2 text-left text-sm text-muted hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50";
