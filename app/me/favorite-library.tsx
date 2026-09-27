import { GameLibrary, type GameLibraryData } from "@/app/components/library/game-library";
import { WorkFavoriteButton } from "@/app/components/work/work-favorite-button";

export function FavoriteLibrary({ data, currentUserId }: { data: GameLibraryData; currentUserId: number }) {
  return (
    <GameLibrary
      data={data}
      basePath="/me/favorites"
      emptyTitle={data.hasFilters ? "没有找到匹配的收藏作品。" : "还没有收藏作品。"}
      renderWorkActions={(work) => (
        <WorkFavoriteButton
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
