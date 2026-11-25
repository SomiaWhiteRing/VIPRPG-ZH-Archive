// Sprite order in the replay-style atlas. Fighter IDs are the game's IDs.
export const fighters: readonly number[] = [8, 14, 1, 3, 4, 6, 12, 2, 15, 10, 9, 11, 5, 7, 13, 18, 17];

export const scopes = ["all", "mine", "others"] as const;
export const defaultStatsStart = "2026-11-13";
export type Scope = (typeof scopes)[number];
export type StatsRow = { icon: number; count: number; wins: number };
export type Stats = {
  matches: number;
  latest: number | null;
  rows: StatsRow[];
};
