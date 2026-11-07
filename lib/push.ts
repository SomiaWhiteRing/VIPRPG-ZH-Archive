import type { AccountPreferences } from "./account-preferences";

export const PUSH_CATEGORIES = [
  { value: "comments", label: "作品评论" },
  { value: "replies", label: "回复" },
  { value: "forum", label: "讨论版" },
  { value: "likes", label: "赞" },
  { value: "friends", label: "好友" },
  { value: "messages", label: "私信" },
  { value: "system", label: "系统" },
] as const;

export type PushCategory = typeof PUSH_CATEGORIES[number]["value"];

export type WebPushJob = { kind: "drain" } | {
  kind: "inbox" | "messages";
  id: number;
  afterSubscriptionId?: number;
} | {
  kind: "deliver";
  eventKind: "inbox" | "messages";
  id: number;
  subscriptionId: number;
  sessionId: number;
  userId: number;
};

export type PushNotificationContent = {
  id: string;
  userId: number;
  group: "inbox" | "messages";
  title: string;
  body: string;
  icon: string;
  url: string;
  timestamp: number;
  actions: { action: "reply" | "friend-accept" | "friend-ignore"; title: string; url?: string }[];
};

export type DeviceNotificationPosition = {
  userId: number;
  sessionId: number;
  inboxAfter: number;
  messageAfter: number;
};

export function availablePushCategories(preferences: Pick<AccountPreferences,
  "notifyUploadedWorkComments" | "notifyFriendAdditions" | "receivePrivateMessages">): PushCategory[] {
  return PUSH_CATEGORIES.map(item => item.value).filter(category =>
    (category !== "comments" || preferences.notifyUploadedWorkComments)
    && (category !== "friends" || preferences.notifyFriendAdditions)
    && (category !== "messages" || preferences.receivePrivateMessages));
}
