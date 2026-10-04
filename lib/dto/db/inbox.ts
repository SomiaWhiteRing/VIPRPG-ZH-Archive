import type { PermissionKey } from "@/lib/authz/permissions";
import type { RoleId, RoleKey } from "@/lib/authz/roles";
import type { MaintainerRequestStatus, MaintainerUser } from "@/lib/work-maintainers";

export type InboxItemType =
  | "role_change_request"
  | "role_change_notice"
  | "system_notice"
  | "forum_reply"
  | "forum_like";

export type InboxItemStatus =
  | "open"
  | "pending"
  | "approved"
  | "rejected"
  | "archived";

export type InboxItem = {
  id: number;
  type: InboxItemType;
  status: InboxItemStatus;
  senderUserId: number | null;
  senderDisplayName: string | null;
  recipientUserId: number | null;
  requiredPermissionKey: PermissionKey | null;
  targetUserId: number | null;
  targetDisplayName: string | null;
  requestedRole: RoleSnapshot | null;
  roleEventId: number | null;
  resolvedByUserId: number | null;
  resolvedByDisplayName: string | null;
  resolvedAt: string | null;
  title: string;
  body: string;
  closedReason: string | null;
  rejectionReason: string | null;
  createdAt: string;
  readAt: string | null;
  canApprove: boolean;
  canReject: boolean;
  maintainerRequest: {
    workId: number;
    workTitle: string;
    applicant: MaintainerUser;
    status: MaintainerRequestStatus;
    canWithdraw: boolean;
  } | null;
  interaction: InboxInteraction | null;
  friendNotification: InboxFriendNotification | null;
  commentNotification: {
    kind: "comment" | "reply" | "like" | "mention";
    targetTitle: string;
    href: string;
    excerpt: string;
    actorName: string;
    actorHref: string | null;
    action: string;
  } | null;
};

export type InboxFriendNotification = {
  userId: number | null;
  kind: "added" | "returned";
  actorName: string;
  actorHref: string | null;
  actorAvatar: string | null;
  action: string;
  isFollowing: boolean;
  canFollow: boolean;
};

export type InboxInteraction = {
  topicId: number;
  postNumber: number;
  commentId: number | null;
  topicTitle: string;
  excerpt: string;
  actorName: string;
  actorHref: string | null;
  actorAvatar: string | null;
  action: string;
};

export type RoleSnapshot = { id: RoleId | null; key: RoleKey; name: string };
