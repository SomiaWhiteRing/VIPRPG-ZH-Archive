import { countGameWorks, listGameWorks, searchUserWorks } from "@/app/.server/db/game-library";
import { getPublicCharacterSummary, getPublicTagSummary, listPublicTags } from "@/app/.server/db/taxonomy-library";
import { parsePositiveId } from "@/app/.server/http/request";
import type { AppRuntime } from "@/app/.server/runtime";
import { stringParam } from "@/lib/params";

const PAGE_SIZE = 20;

export async function loadGameLibrary(
  runtime: AppRuntime,
  params: Record<string, string | string[] | undefined>,
  userList?: { userId: number; kind: "favorite" | "played" },
) {
  const userWorks = userList
    ? await searchUserWorks(runtime, {
        ...userList,
        page: Math.max(1, Number.parseInt(stringParam(params.page) || "1", 10) || 1),
        pageSize: PAGE_SIZE,
      })
    : null;
  if (userWorks) params = { page: params.page, view: params.view };
  const engine = stringParam(params.engine) || "all";
  const tag = parseOptionalId(stringParam(params.tag));
  const character = parseOptionalId(stringParam(params.character));
  const language = stringParam(params.language);
  const original = stringParam(params.original);
  const requestedView = stringParam(params.view);
  const view = requestedView === "grid" ? "grid" : "list";
  const requestedSort = stringParam(params.sort);
  const sort =
    requestedSort === "title" || requestedSort === "release"
      ? requestedSort
      : "id";
  const page = Math.max(
    1,
    Number.parseInt(stringParam(params.page) || "1", 10) || 1,
  );
  const filters = {
    engine,
    tag: tag ?? undefined,
    character: character ?? undefined,
    language: language || undefined,
    isOriginal: original === "1" ? true : original === "0" ? false : undefined,
  };
  const [works, total, selectedTag, selectedCharacter, popularTags] =
    await Promise.all([
      userWorks ? Promise.resolve(userWorks.items.map(({ work }) => work)) : listGameWorks(runtime, {
        ...filters,
        sort,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
      userWorks ? Promise.resolve(userWorks.total) : countGameWorks(runtime, filters),
      tag ? getPublicTagSummary(runtime, tag) : Promise.resolve(null),
      character
        ? getPublicCharacterSummary(runtime, character)
        : Promise.resolve(null),
      userWorks ? Promise.resolve([]) : listPublicTags(runtime, { limit: 12 }),
    ]);
  const activeParams = {
    engine: engine !== "all" ? engine : undefined,
    tag: tag ? String(tag) : undefined,
    character: character ? String(character) : undefined,
    language: language || undefined,
    original: original || undefined,
    sort: sort !== "id" ? sort : undefined,
    view: view !== "list" ? view : undefined,
  };
  const isListView = view === "list";
  const hasFilters =
    engine !== "all" || Boolean(tag || character || language || original);

  return {
    userWorkKind: userList?.kind ?? null,
    occurredTimes: userWorks
      ? Object.fromEntries(userWorks.items.map(({ work, occurredAt }) => [work.id, occurredAt]))
      : null,
    engine,
    tag,
    character,
    language,
    original,
    view,
    sort,
    page,
    pageSize: PAGE_SIZE,
    works,
    total,
    selectedTag,
    selectedCharacter,
    popularTags,
    activeParams,
    isListView,
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
