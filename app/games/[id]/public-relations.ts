import type { GameWorkDetail, GameTranslationRelation, GameWorkRelation } from "@/lib/dto/db/game-library";
import { WORK_RELATION_TYPES, relationLabel } from "@/lib/labels";
import { translate } from "@/lib/i18n/core";
import type { UiLocale } from "@/lib/i18n/locale";

export function publicRelationLabel(type: string, locale: UiLocale) {
  if (type === "original") return translate(locale, "relation.original");
  if (type === "parallel_translation") return translate(locale, "relation.parallelTranslation");
  return relationLabel(type, locale);
}

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
        ? "original"
        : "parallel_translation",
      title: item.title,
      coverBlobSha256: item.coverBlobSha256 ?? null,
    })),
    ...orderedRelations.map((item) => ({
      key: `relation-${item.id}`,
      workId: item.workId,
      href: `/games/${item.workId}`,
      type: item.relationType,
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
