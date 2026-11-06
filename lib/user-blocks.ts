export const USER_BLOCK_OPTIONS = [
  { key: "blockPrivateMessages", label: "私信" },
  { key: "muteComments", label: "作品评论" },
  { key: "muteReplies", label: "回帖与回复" },
  { key: "muteMentions", label: "@提及" },
  { key: "muteLikes", label: "点赞" },
  { key: "muteFriends", label: "好友申请" },
] as const;

export type UserBlockSettings = Record<typeof USER_BLOCK_OPTIONS[number]["key"], boolean>;
export type UserBlockState = "none" | "partial" | "all";

export function userBlockState(settings: UserBlockSettings): UserBlockState {
  const count = USER_BLOCK_OPTIONS.filter(option => settings[option.key]).length;
  return count === 0 ? "none" : count === USER_BLOCK_OPTIONS.length ? "all" : "partial";
}
