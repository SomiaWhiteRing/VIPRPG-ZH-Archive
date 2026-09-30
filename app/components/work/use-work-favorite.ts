import { useState } from "react";
import type { WorkCommunitySummary } from "@/lib/dto/db/work-community";
import type { WorkFavoriteUpdate, WorkTagSummary } from "@/lib/user-tags";

export function useWorkFavorite(initial: WorkCommunitySummary, tags?: WorkTagSummary[]) {
  const [snapshot, setSnapshot] = useState<{ source: WorkCommunitySummary; update: WorkFavoriteUpdate } | null>(null);
  const update = snapshot?.source === initial ? snapshot.update : null;
  return {
    community: update ? { ...initial, favoriteCount: update.favoriteCount ?? initial.favoriteCount, favoritedByMe: update.favorited } : initial,
    tags: update?.tags ?? tags ?? [],
    onSaved: (update: WorkFavoriteUpdate) => setSnapshot({ source: initial, update }),
  };
}
