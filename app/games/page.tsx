import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { HomeGameCard } from "@/app/components/home/game-card";
import { LibraryFacetIndex } from "@/app/components/library/library-facets";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { listGameWorks, listPublicCharacters, listPublicTags } from "@/lib/server/db/game-library";
import { listPublicSeries } from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";
import { stringParam } from "@/lib/params";

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
  const requestedSort = stringParam(params.sort);
  const sort = requestedSort === "title" || requestedSort === "engine" ? requestedSort : "updated";
  const page = Math.max(1, Number.parseInt(stringParam(params.page) || "1", 10) || 1);
  const [works, tags, characters, series] = await Promise.all([
    listGameWorks({
      engine,
      tag,
      character,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    listPublicTags(30),
    listPublicCharacters(30),
    listPublicSeries({ limit: 24 }),
  ]);
  const activeParams = {
    engine: engine !== "all" ? engine : undefined,
    tag: tag || undefined,
    character: character || undefined,
    sort: sort !== "updated" ? sort : undefined,
  };

  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-12 sm:py-16">
      <header className="mb-5 flex items-end justify-between gap-5 mb-6 flex items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.14em] text-accent">GAME LIBRARY</p>
          <h1>全部游戏</h1>
          <p>按作品、引擎和分类浏览可游玩与下载的游戏。</p>
        </div>
        <span className="text-sm font-bold text-muted">
          第 {page} 页 · {formatNumber(works.length)} 个作品
        </span>
      </header>
      <section
        className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-bold text-muted"
        aria-label="游戏排序"
      >
        <span>排序</span>
        {(["updated", "title", "engine"] as const).map((value) => (
          <Link
            className={sort === value ? "text-primary underline decoration-2 underline-offset-4" : undefined}
            href={gamesHref({
              ...activeParams,
              sort: value === "updated" ? undefined : value,
            })}
            key={value}
          >
            {value === "updated" ? "最近更新" : value === "title" ? "标题" : "引擎"}
          </Link>
        ))}
      </section>
      <LibraryFacetIndex
        characters={characters}
        engines={ENGINES.map(([value, label]) => ({
          href: gamesHref({
            ...activeParams,
            engine: value === "all" ? undefined : value,
          }),
          label,
          active: engine === value,
        }))}
        series={series}
        tags={tags}
      />
      {engine !== "all" || tag || character || sort !== "updated" ? (
        <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted" aria-label="当前筛选">
          <span>当前筛选</span>
          <Link href="/games">清除全部</Link>
          {engine !== "all" ? (
            <Link href={gamesHref({ ...activeParams, engine: undefined })}>
              引擎：{ENGINES.find(([value]) => value === engine)?.[1] ?? engine} ×
            </Link>
          ) : null}
          {tag ? (
            <Link href={gamesHref({ ...activeParams, tag: undefined })}>
              标签：{tags.find((item) => item.slug === tag)?.name ?? tag} ×
            </Link>
          ) : null}
          {character ? (
            <Link href={gamesHref({ ...activeParams, character: undefined })}>
              角色：
              {characters.find((item) => item.slug === character)?.primaryName ?? character} ×
            </Link>
          ) : null}
        </div>
      ) : null}
      {works.length > 0 ? (
        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-label="作品列表">
          {works.map((work) => (
            <HomeGameCard key={work.id} work={work} />
          ))}
        </section>
      ) : (
        <EmptyState title="没有找到匹配的作品。" />
      )}
      <PaginationLinks basePath="/games" page={page} hasNext={works.length === PAGE_SIZE} params={activeParams} />
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
