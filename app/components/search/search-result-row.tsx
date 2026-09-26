import { Badge } from "@/app/components/ui/badge";
import { GameLibraryListRow } from "@/app/games/game-library-list-row";
import type { GameWorkSummary } from "@/lib/dto/db/game-library";

export function SearchResultRow({ work }: { work: GameWorkSummary }) {
  return (
    <GameLibraryListRow work={work} showDownload={false}>
      <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-[13px] leading-relaxed text-muted">
        {work.description || "暂无简介。"}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {work.characters.slice(0, 1).map((character) => (
          <Badge variant="subtle" key={character.id}>
            {character.displayName}
          </Badge>
        ))}
        {work.tags.slice(0, 2).map((tag) => (
          <Badge variant="subtle" key={tag.id}>
            {tag.name}
          </Badge>
        ))}
      </div>
    </GameLibraryListRow>
  );
}
