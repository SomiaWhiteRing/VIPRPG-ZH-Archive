import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { HomeGameCard } from "@/app/components/home/game-card";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { countGameWorks, listGameWorks } from "@/lib/server/db/game-library";
import {
  getPublicCharacterSummary,
  getPublicTagSummary,
} from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";
import { stringParam } from "@/lib/params";
import { LANGUAGE_OPTIONS, languageLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";
type GamesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const PAGE_SIZE = 24;
const ENGINES = [
  ["all", "全部"],
  ["rpg_maker_2000", "RPG Maker 2000"],
  ["rpg_maker_2003", "RPG Maker 2003"],
  ["mixed", "混合"],
  ["unknown", "未知"],
  ["other", "其他"],
] as const;

export default async function GamesPage({ searchParams }: GamesPageProps) {
  const params = await searchParams;
  const engine = stringParam(params.engine) || "all";
  const tag = stringParam(params.tag);
  const character = stringParam(params.character);
  const language = stringParam(params.language);
  const original = stringParam(params.original);
  const requestedSort = stringParam(params.sort);
  const sort =
    requestedSort === "title" || requestedSort === "engine"
      ? requestedSort
      : "updated";
  const page = Math.max(
    1,
    Number.parseInt(stringParam(params.page) || "1", 10) || 1,
  );
  const filters = {
    engine,
    tag,
    character,
    language: language || undefined,
    isOriginal: original === "1" ? true : original === "0" ? false : undefined,
  };
  const [works, total, selectedTag, selectedCharacter] = await Promise.all([
    listGameWorks({
      ...filters,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    countGameWorks(filters),
    tag ? getPublicTagSummary(tag) : Promise.resolve(null),
    character ? getPublicCharacterSummary(character) : Promise.resolve(null),
  ]);
  const activeParams = {
    engine: engine !== "all" ? engine : undefined,
    tag: tag || undefined,
    character: character || undefined,
    language: language || undefined,
    original: original || undefined,
    sort: sort !== "updated" ? sort : undefined,
  };

  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-12 sm:py-16">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1>全部游戏</h1>
          <p>浏览可游玩与下载的游戏。</p>
        </div>
        <span className="text-sm font-bold text-muted">
          第 {page} 页 · 共 {formatNumber(total)} 个作品
        </span>
      </header>
      <section
        className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-bold text-muted"
        aria-label="游戏排序"
      >
        <span>排序</span>
        {(["updated", "title", "engine"] as const).map((value) => (
          <Link
            className={
              sort === value
                ? "text-primary underline decoration-2 underline-offset-4"
                : undefined
            }
            href={gamesHref({
              ...activeParams,
              sort: value === "updated" ? undefined : value,
            })}
            key={value}
          >
            {value === "updated"
              ? "最近更新"
              : value === "title"
                ? "标题"
                : "引擎"}
          </Link>
        ))}
      </section>
      <div className="mb-5 grid gap-3" aria-label="游戏筛选">
        <div className="flex flex-wrap items-center gap-3 text-sm font-bold">
          <span className="text-muted">引擎</span>
          {ENGINES.map(([value, label]) => (
            <Link
              className={
                engine === value
                  ? "text-primary underline underline-offset-4"
                  : undefined
              }
              href={gamesHref({
                ...activeParams,
                engine: value === "all" ? undefined : value,
              })}
              key={value}
            >
              {label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm font-bold">
          <span className="text-muted">原创</span>
          <Link
            className={
              !original
                ? "text-primary underline underline-offset-4"
                : undefined
            }
            href={gamesHref({ ...activeParams, original: undefined })}
          >
            全部
          </Link>
          <Link
            className={
              original === "1"
                ? "text-primary underline underline-offset-4"
                : undefined
            }
            href={gamesHref({ ...activeParams, original: "1" })}
          >
            本站原创
          </Link>
          <Link
            className={
              original === "0"
                ? "text-primary underline underline-offset-4"
                : undefined
            }
            href={gamesHref({ ...activeParams, original: "0" })}
          >
            社区收录
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm font-bold">
          <span className="text-muted">语言</span>
          <Link
            className={
              !language
                ? "text-primary underline underline-offset-4"
                : undefined
            }
            href={gamesHref({ ...activeParams, language: undefined })}
          >
            全部
          </Link>
          {LANGUAGE_OPTIONS.map((item) => (
            <Link
              className={
                language === item.value
                  ? "text-primary underline underline-offset-4"
                  : undefined
              }
              href={gamesHref({ ...activeParams, language: item.value })}
              key={item.value}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
      {engine !== "all" ||
      tag ||
      character ||
      language ||
      original ||
      sort !== "updated" ? (
        <div
          className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted"
          aria-label="当前筛选"
        >
          <span>当前筛选</span>
          <Link href="/games">清除全部</Link>
          {engine !== "all" ? (
            <Link href={gamesHref({ ...activeParams, engine: undefined })}>
              引擎：{ENGINES.find(([value]) => value === engine)?.[1] ?? engine}{" "}
              ×
            </Link>
          ) : null}
          {tag ? (
            <Link href={gamesHref({ ...activeParams, tag: undefined })}>
              标签：{selectedTag?.name ?? tag} ×
            </Link>
          ) : null}
          {character ? (
            <Link href={gamesHref({ ...activeParams, character: undefined })}>
              角色：
              {selectedCharacter?.primaryName ?? character} ×
            </Link>
          ) : null}
          {language ? (
            <Link href={gamesHref({ ...activeParams, language: undefined })}>
              语言：{languageLabel(language)} ×
            </Link>
          ) : null}
          {original ? (
            <Link href={gamesHref({ ...activeParams, original: undefined })}>
              {original === "1" ? "本站原创" : "社区收录"} ×
            </Link>
          ) : null}
        </div>
      ) : null}
      {works.length > 0 ? (
        <section
          className="grid gap-5 md:grid-cols-2 xl:grid-cols-3"
          aria-label="作品列表"
        >
          {works.map((work) => (
            <HomeGameCard key={work.id} work={work} />
          ))}
        </section>
      ) : (
        <EmptyState title="没有找到匹配的作品。" />
      )}
      <PaginationLinks
        basePath="/games"
        page={page}
        hasNext={page * PAGE_SIZE < total}
        params={activeParams}
      />
    </main>
  );
}

function gamesHref(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const text = query.toString();
  return text ? `/games?${text}` : "/games";
}
