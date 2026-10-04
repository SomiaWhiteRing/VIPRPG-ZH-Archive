import { countGameWorks, listGameWorks, searchUserWorks } from "@/app/.server/db/game-library";
import { findPublicUserById } from "@/app/.server/db/users";
import { getPublicCharacterSummary, getPublicTagSummary } from "@/app/.server/db/taxonomy-library";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { stringParam } from "@/lib/params";
import { normalizeEntityName } from "@/lib/entity-name";
import { getTagSource } from "@/lib/user-tags";
import { listCombinedTags, listUserTags } from "@/app/.server/db/user-work-tags";
import { normalizeReleasePeriod } from "@/lib/release-period";
import { WORK_REFERENCE_DURATIONS } from "@/lib/work-reference-duration";

const PAGE_SIZE = 20;

export async function loadGameLibrary(
  runtime: AppRuntime,
  params: Record<string, string | string[] | undefined>,
  userList?: { userId: number; kind: "favorite" | "played" },
) {
  if (userList) params = { page: params.page, tag: userList.kind === "favorite" ? params.tag : undefined };
  const tag = normalizeEntityName(stringParam(params.tag));
  const genre = stringParam(params.genre).trim();
  const tagSource = userList ? "user" : getTagSource(stringParam(params.tag_source));
  const userWorks = userList
    ? await searchUserWorks(runtime, {
        ...userList,
        tag,
        page: Math.max(1, Number.parseInt(stringParam(params.page) || "1", 10) || 1),
        pageSize: PAGE_SIZE,
      })
    : null;
  const engine = stringParam(params.engine) || "all";
  const requestedDuration = stringParam(params.duration);
  const referenceDuration: (typeof WORK_REFERENCE_DURATIONS)[number] | "custom" | "" = WORK_REFERENCE_DURATIONS.find((value) => value === requestedDuration)
    ?? (requestedDuration === "custom" ? "custom" : "");
  const character = parseOptionalId(stringParam(params.character));
  const uploader = parseOptionalId(stringParam(params.uploader));
  const language = stringParam(params.language);
  const original = stringParam(params.original);
  const release = normalizeReleasePeriod(stringParam(params.release));
  const requestedSort = stringParam(params.sort);
  const sort =
    requestedSort === "title" || requestedSort === "release" ||
    requestedSort === "views" || requestedSort === "players" || requestedSort === "comments" ||
    requestedSort === "favorites"
      ? requestedSort
      : "id";
  const page = Math.max(
    1,
    Number.parseInt(stringParam(params.page) || "1", 10) || 1,
  );
  const filters = {
    genre: genre || undefined,
    release: release || undefined,
    engine,
    referenceDuration: referenceDuration || undefined,
    tag: tag || undefined,
    tagSource,
    character: character ?? undefined,
    uploader: uploader ?? undefined,
    language: language || undefined,
    isOriginal: original === "1" ? true : original === "0" ? false : undefined,
  };
  const [works, total, selectedTag, selectedCharacter, favoriteTags, selectedUploader] =
    await Promise.all([
      userWorks ? Promise.resolve(userWorks.items.map(({ work }) => work)) : listGameWorks(runtime, {
        ...filters,
        sort,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
      userWorks ? Promise.resolve(userWorks.total) : countGameWorks(runtime, filters),
      tag ? tagSource === "all"
        ? listCombinedTags(runtime, { name: tag, limit: 1 }).then((tags) => tags[0] ?? null)
        : tagSource === "user"
        ? (userList
          ? listUserTags(runtime, { name: tag, userId: userList.userId, limit: 1 })
          : listCombinedTags(runtime, { name: tag, source: "user", limit: 1 })).then((tags) => tags[0] ?? null)
        : getPublicTagSummary(runtime, tag)
        : Promise.resolve(null),
      character
        ? getPublicCharacterSummary(runtime, character)
        : Promise.resolve(null),
      userList?.kind === "favorite" ? listUserTags(runtime, { userId: userList.userId, limit: 60 }) : Promise.resolve([]),
      uploader ? findPublicUserById(runtime, uploader) : Promise.resolve(null),
    ]);
  const activeParams = {
    genre: genre || undefined,
    release: release || undefined,
    engine: engine !== "all" ? engine : undefined,
    duration: referenceDuration || undefined,
    tag: tag || undefined,
    tag_source: !userList && tagSource !== "all" ? tagSource : undefined,
    character: character ? String(character) : undefined,
    uploader: uploader ? String(uploader) : undefined,
    language: language || undefined,
    original: original || undefined,
    sort: sort !== "id" ? sort : undefined,
  };
  const hasFilters =
    engine !== "all" || Boolean(genre || tag || character || uploader || language || original || release || referenceDuration);

  return {
    genre,
    release,
    currentYear: new Date().getUTCFullYear(),
    userWorkKind: userList?.kind ?? null,
    occurredTimes: userWorks
      ? Object.fromEntries(userWorks.items.map(({ work, occurredAt }) => [work.id, occurredAt]))
      : null,
    favoriteDetails: userWorks && userList?.kind === "favorite"
      ? Object.fromEntries(userWorks.items.map(({ work, favorite }) => [work.id, favorite]))
      : null,
    engine,
    referenceDuration,
    tag,
    tagSource,
    character,
    uploader,
    uploaderName: selectedUploader?.displayName ?? null,
    language,
    original,
    sort,
    page,
    pageSize: PAGE_SIZE,
    works,
    total,
    selectedTag,
    selectedCharacter,
    favoriteTags,
    activeParams,
    hasFilters,
  };
}

function parseOptionalId(value: string | null): number | null {
  if (!value) return null;
  try {
    return parsePositiveId(value);
  } catch {
    return null;
  }
}
