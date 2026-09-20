import { GameLibrary, type GameLibraryData } from "@/app/components/library/game-library";
import { Button } from "@/app/components/ui/button";
import { useState } from "react";
import { useRevalidator } from "react-router";

export function FavoriteLibrary({ data }: { data: GameLibraryData }) {
  const revalidator = useRevalidator();
  const [busyId, setBusyId] = useState<number | null>(null);
  async function remove(workId: number) {
    setBusyId(workId);
    try {
      const response = await fetch(`/api/works/${workId}/me`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorited: false }),
      });
      if (response.ok) revalidator.revalidate();
    } finally {
      setBusyId(null);
    }
  }
  return (
    <GameLibrary
      data={data}
      basePath="/me/favorites"
      emptyTitle={data.hasFilters ? "没有找到匹配的收藏作品。" : "还没有收藏作品。"}
      renderWorkActions={(work) => (
        <Button
          variant="outline"
          className={data.isListView ? "min-h-11 px-3.5 text-xs" : "min-h-7 px-1.5 py-0.5 text-[11px]"}
          disabled={busyId === work.id}
          onClick={() => remove(work.id)}
          type="button"
        >
          {busyId === work.id ? "正在取消…" : "取消收藏"}
        </Button>
      )}
    />
  );
}
