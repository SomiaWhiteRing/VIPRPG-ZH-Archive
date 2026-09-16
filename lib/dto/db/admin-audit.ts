import type { RoleSnapshot } from "@/lib/dto/db/inbox";

export type AdminAuditLog = {
  id: number;
  userId: number | null;
  actorName: string | null;
  email: string | null;
  eventType: string;
  ipHash: string | null;
  userAgentHash: string | null;
  detail: unknown;
  createdAt: string;
};

export type AdminRoleEvent = {
  id: number;
  actorUserId: number | null;
  actorName: string | null;
  targetUserId: number;
  targetName: string | null;
  action: "assigned" | "removed";
  role: RoleSnapshot;
  reason: string | null;
  sourceInboxItemId: number | null;
  createdAt: string;
};
