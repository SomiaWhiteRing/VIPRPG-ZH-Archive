import type { GameWorkSummary } from "@/lib/dto/db/game-library";

export type MaterialSearchWork = Pick<GameWorkSummary,
  "id" | "originalTitle" | "chineseTitle" | "coverBlobSha256">;

export type MaterialSearchResult = {
  works: MaterialSearchWork[];
  nextCursor: number | null;
};

export type MaterialSearchResponse = MaterialSearchResult & { ok: true };
