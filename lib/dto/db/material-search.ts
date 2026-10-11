import type { GameWorkSummary } from "@/lib/dto/db/game-library";
import type { WorkAudience } from "@/lib/work-visibility";

export type MaterialSearchWork = Pick<GameWorkSummary,
  "id" | "originalTitle" | "chineseTitle" | "coverBlobSha256"> & { audience: WorkAudience };

export type MaterialSearchResult = {
  works: MaterialSearchWork[];
  nextCursor: number | null;
};

export type MaterialSearchResponse = MaterialSearchResult & { ok: true };
