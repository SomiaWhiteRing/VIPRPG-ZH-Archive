import type { GameWorkDetail, GameTranslationRelation, GameWorkRelation } from "@/lib/dto/db/game-library";
import { WORK_RELATION_TYPES, relationLabel } from "@/lib/labels";

export const CHARACTER_ROLE_LABELS: Record<string, string> = {
  main: "主角",
  supporting: "配角",
  cameo: "客串",
  mentioned: "提及",
  other: "其他",
};

export function getPublicRelationCards(work: GameWorkDetail) {
  const relatedTranslations = dedupeTranslations([
    ...work.translations,
    ...work.parallelTranslations,
  ])
    .filter((item) => item.workId !== work.id)
    .sort(compareTranslations);
  const orderedRelations = WORK_RELATION_TYPES.flatMap((type) =>
    work.relations
      .filter((relation) => relation.relationType === type)
      .sort(compareRelatedWorks),
  );
  return [
    ...relatedTranslations.map((item) => ({
      key: `translation-${item.workId}`,
      workId: item.workId,
      href: `/games/${item.workId}`,
      type: item.role === "original"
        ? "原版"
        : "其他译版",
      title: item.title,
      coverBlobSha256: item.coverBlobSha256 ?? null,
    })),
    ...orderedRelations.map((item) => ({
      key: `relation-${item.id}`,
      workId: item.workId,
      href: `/games/${item.workId}`,
      type: relationLabel(item.relationType),
      title: item.title,
      coverBlobSha256: item.coverBlobSha256 ?? null,
    })),
  ];
}

function dedupeTranslations(
  items: GameTranslationRelation[],
): GameTranslationRelation[] {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (seen.has(item.workId)) return false;
    seen.add(item.workId);
    return true;
  });
}

function compareRelatedWorks(
  left: GameWorkRelation,
  right: GameWorkRelation,
): number {
  return (
    left.title.localeCompare(right.title, "zh-CN") || left.workId - right.workId
  );
}

function compareTranslations(
  left: GameTranslationRelation,
  right: GameTranslationRelation,
): number {
  const roleOrder =
    Number(left.role === "translation") - Number(right.role === "translation");
  return (
    roleOrder ||
    left.title.localeCompare(right.title, "zh-CN") ||
    left.workId - right.workId
  );
}
