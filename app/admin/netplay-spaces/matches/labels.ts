import type { useMessages } from "@/lib/i18n/react";
import type { MessageKey } from "@/lib/i18n/core";

export const MATCHES_PATH = "/admin/netplay-spaces/matches";

export const END_REASONS: Readonly<Record<string, MessageKey>> = {
  settled: "admin.netplay.reason.settled",
  closed: "admin.netplay.reason.closed",
  peer_left: "admin.netplay.reason.peer_left",
  interrupted: "admin.netplay.reason.interrupted",
  finish_timeout: "admin.netplay.reason.finish_timeout",
  finish_mismatch: "admin.netplay.reason.finish_mismatch",
  user_cancel: "admin.netplay.reason.user_cancel",
  next_match: "admin.netplay.reason.next_match",
  match_end: "admin.netplay.reason.match_end",
};

export function endReasonLabel(reason: string | null, t: ReturnType<typeof useMessages>) {
  return reason ? Object.hasOwn(END_REASONS, reason) ? t(END_REASONS[reason]) : reason : "—";
}
