import { GameLibrary, type GameLibraryData } from "@/app/components/library/game-library";
import { WorkFavoriteButton } from "@/app/components/work/work-favorite-button";

export function FavoriteLibrary({ data, currentUserId, unavailableCount = 0, onSaved }: {
  data: GameLibraryData; currentUserId: number; unavailableCount?: number; onSaved: () => Promise<void>;
}) {
  return (
    <GameLibrary
      data={data}
      basePath="/me/favorites"
      emptyTitle={data.hasFilters ? "没有找到匹配的收藏作品。" : unavailableCount > 0 ? "没有可访问的收藏作品。" : "还没有收藏作品。"}
      renderWorkActions={(work) => (
        <WorkFavoriteButton
          onSaved={onSaved}
          appearance="manage"
          currentUserId={currentUserId}
          initialFavorited
          workId={work.id}
          workTitle={work.chineseTitle || work.originalTitle}
        />
      )}
    />
  );
}
