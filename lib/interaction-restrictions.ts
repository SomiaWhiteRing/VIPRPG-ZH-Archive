export const INTERACTION_RESTRICTIONS = [
  { kind: "like", label: "点赞" },
  { kind: "reply", label: "回帖与回复" },
  { kind: "mention", label: "@ 提及" },
  { kind: "message", label: "私信" },
  { kind: "friend", label: "加为好友" },
] as const;

export type RestrictedInteraction = typeof INTERACTION_RESTRICTIONS[number]["kind"];
