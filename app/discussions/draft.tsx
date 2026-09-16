import { BottomBar } from "@/app/components/ui/bottom-bar";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import type { ForumEditVersion, ForumTarget, ForumViewer } from "@/lib/forum";
import type { ReactNode } from "react";
import type { DraftImage } from "./images";

export type ForumDraft = {
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

export function ForumReplyBar({
  children,
  viewer,
}: {
  children: ReactNode;
  viewer: ForumViewer;
}) {
  return (
    <BottomBar anchorId="post-1">
      <div className="mx-auto flex w-[min(1180px,calc(100%-2rem))] items-start gap-3 py-3">
        {viewer ? (
          <UserAvatar
            displayName={viewer.name}
            avatarBlobSha256={viewer.avatar}
            className="size-8 sm:size-10"
          />
        ) : null}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </BottomBar>
  );
}

export const forumReplyLauncherClass =
  "flex min-h-10 w-full items-center justify-start gap-2 font-normal rounded-md border border-border bg-muted/10 px-3 py-2 text-left text-sm text-muted hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50";
