import { GameLibrary, type GameLibraryData } from "@/app/components/library/game-library";
import { WorkFavoriteButton } from "@/app/components/work/work-favorite-button";
import { useMessages } from "@/lib/i18n/react";

export function FavoriteLibrary({ data, currentUserId, unavailableCount = 0, onSaved }: {
  data: GameLibraryData; currentUserId: number; unavailableCount?: number; onSaved: () => Promise<void>;
}) {
  const t = useMessages();
  return (
    <GameLibrary
      data={data}
      basePath="/me/favorites"
      emptyTitle={t(data.hasFilters ? "publicProfile.noFilteredFavorites" : unavailableCount > 0 ? "favorites.noAccessible" : "favorites.empty")}
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
