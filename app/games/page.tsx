import Link from "next/link";
import { LayoutGrid, List } from "lucide-react";
import { EmptyState } from "@/app/components/ui/empty-state";
import { GameCard } from "@/app/components/home/game-card";
import { GameLibraryListRow } from "@/app/games/game-library-list-row";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { countGameWorks, listGameWorks } from "@/lib/server/db/game-library";
import {
  listPublicTags,
  getPublicCharacterSummary,
  getPublicTagSummary,
} from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";
import { stringParam } from "@/lib/params";
import { ENGINE_OPTIONS, LANGUAGE_OPTIONS, languageLabel } from "@/lib/labels";
import { parsePositiveId } from "@/lib/server/http/request";

export const dynamic = "force-dynamic";
type GamesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const PAGE_SIZE = 20;
const ENGINES = [
  { value: "all", label: "全部" },
  ...ENGINE_OPTIONS.map(({ value, label }) => ({ value, label })),
];

export default async function GamesPage({ searchParams }: GamesPageProps) {
  const params = await searchParams;
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
  const [
    works,
    total,
    selectedTag,
    selectedCharacter,
    popularTags,
  ] = await Promise.all([
    listGameWorks({
      ...filters,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    countGameWorks(filters),
    tag ? getPublicTagSummary(tag) : Promise.resolve(null),
    character ? getPublicCharacterSummary(character) : Promise.resolve(null),
    listPublicTags({ limit: 12 }),
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
  const WorkCard = isListView ? GameLibraryListRow : GameCard;
  const hasFilters = engine !== "all" || Boolean(tag || character || language || original);

  return (
    <main className="mx-auto w-[min(1280px,calc(100vw-2rem))] py-5 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2 border-b border-border pb-4.5">
        <div>
          <h1 className="m-0 font-display text-[clamp(24px,3vw,30px)] font-bold leading-[1.2]">全部游戏</h1>
          <p className="mt-1.5 text-[13.5px] text-muted">浏览可游玩与下载的游戏。</p>
        </div>
        <span className="pb-0.5 font-mono text-[12.5px] text-muted">共 {formatNumber(total)} 个作品</span>
      </header>
      <div className="grid gap-x-9 pb-11 min-[981px]:grid-cols-[minmax(0,1fr)_252px]">
        <div className="@container min-w-0">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 py-2.5" aria-label="游戏工具栏">
            <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-muted" aria-label="游戏排序">
              <span className="text-[13px]">排序</span>
              {(["id", "title", "release"] as const).map((value) => (
                <Link className={sort === value ? "min-h-8 py-1.5 text-primary" : "min-h-8 py-1.5 hover:text-foreground"} href={gamesHref({ ...activeParams, sort: value === "id" ? undefined : value, page: undefined })} key={value}>
                  {value === "id" ? "默认" : value === "title" ? "标题" : "发布日期"}
                </Link>
              ))}
            </div>
            <div className="ml-auto inline-flex overflow-hidden rounded-md border border-border bg-card text-[13px] font-semibold" aria-label="显示方式">
              <Link aria-current={view === "list" ? "page" : undefined} aria-label="列表视图" className={view === "list" ? "inline-flex min-h-8 items-center gap-1.5 bg-foreground px-3 text-white" : "inline-flex min-h-8 items-center gap-1.5 px-3 text-muted hover:text-foreground"} href={gamesHref({ ...activeParams, view: undefined, page: undefined })}><List aria-hidden size={14} /><span className="max-[560px]:hidden">列表</span></Link>
              <Link aria-current={view === "grid" ? "page" : undefined} aria-label="网格视图" className={view === "grid" ? "inline-flex min-h-8 items-center gap-1.5 border-l border-border bg-foreground px-3 text-white" : "inline-flex min-h-8 items-center gap-1.5 border-l border-border px-3 text-muted hover:text-foreground"} href={gamesHref({ ...activeParams, view: "grid", page: undefined })}><LayoutGrid aria-hidden size={14} /><span className="max-[560px]:hidden">网格</span></Link>
            </div>
          </div>
          {hasFilters ? (
            <div className="mb-5 flex flex-wrap items-center gap-2 text-sm" aria-label="当前筛选">
              <span className="font-bold text-muted">当前筛选</span>
              <Link className="font-bold text-accent hover:underline" href="/games">清除全部</Link>
              {engine !== "all" ? <FilterChip href={gamesHref({ ...activeParams, engine: undefined })} label={`引擎：${ENGINES.find((option) => option.value === engine)?.label ?? engine}`} /> : null}
              {tag ? <FilterChip href={gamesHref({ ...activeParams, tag: undefined })} label={`标签：${selectedTag?.name ?? tag}`} /> : null}
              {character ? <FilterChip href={gamesHref({ ...activeParams, character: undefined })} label={`角色：${selectedCharacter?.primaryName ?? character}`} /> : null}
              {language ? <FilterChip href={gamesHref({ ...activeParams, language: undefined })} label={`语言：${languageLabel(language)}`} /> : null}
              {original ? <FilterChip href={gamesHref({ ...activeParams, original: undefined })} label={original === "1" ? "本站原创" : "社区收录"} /> : null}
            </div>
          ) : null}
          {works.length > 0 ? (
            <section
              aria-label={isListView ? "作品列表" : "作品网格"}
              className={isListView ? "divide-y divide-border border-y border-border" : "grid grid-cols-2 gap-x-2.5 gap-y-3 @min-[609px]:grid-cols-3 @min-[609px]:gap-3.5 @min-[889px]:grid-cols-4 @min-[889px]:gap-4"}
            >
              {works.map((work) => <WorkCard key={work.id} work={work} />)}
            </section>
          ) : <EmptyState title="没有找到匹配的作品。" />}
          <PaginationLinks basePath="/games" page={page} pageSize={PAGE_SIZE} params={activeParams} total={total} />
        </div>
        <aside className="mt-5 rounded-lg border border-border bg-muted/5 p-3 min-[981px]:sticky min-[981px]:top-18.5 min-[981px]:mt-1 min-[981px]:self-start min-[981px]:border-0 min-[981px]:bg-transparent min-[981px]:p-0" aria-label="游戏筛选">
          <FilterSection label="来源">
            <FilterLink active={!original} href={gamesHref({ ...activeParams, original: undefined, page: undefined })} label="全部" />
            <FilterLink active={original === "1"} href={gamesHref({ ...activeParams, original: "1", page: undefined })} label="本站原创" />
            <FilterLink active={original === "0"} href={gamesHref({ ...activeParams, original: "0", page: undefined })} label="社区收录" />
          </FilterSection>
          <FilterSection label="引擎">
            <CollapsibleFilterLinks
              options={ENGINES.map(({ value, label }) => ({
                active: engine === value,
                href: gamesHref({ ...activeParams, engine: value === "all" ? undefined : value, page: undefined }),
                label,
                value,
              }))}
              visibleCount={4}
            />
          </FilterSection>
          <FilterSection label="语言">
            <CollapsibleFilterLinks
              options={[
                {
                  active: !language,
                  href: gamesHref({ ...activeParams, language: undefined, page: undefined }),
                  label: "全部",
                  value: "all",
                },
                ...LANGUAGE_OPTIONS.map(({ value, label }) => ({
                  active: language === value,
                  href: gamesHref({ ...activeParams, language: value, page: undefined }),
                  label,
                  value,
                })),
              ]}
              visibleCount={3}
            />
          </FilterSection>
          <FilterSection label="标签" moreHref="/tags">
            <FilterLink active={!tag} href={gamesHref({ ...activeParams, tag: undefined, page: undefined })} label="全部" />
            {popularTags.map((item) => <FilterLink active={tag === item.id} href={gamesHref({ ...activeParams, tag: String(item.id), page: undefined })} key={item.id} label={item.name} />)}
          </FilterSection>
        </aside>
      </div>
    </main>
  );
}

type FilterOptionLink = {
  active: boolean;
  href: string;
  label: string;
  value: string;
};

function CollapsibleFilterLinks({ options, visibleCount }: { options: readonly FilterOptionLink[]; visibleCount: number }) {
  const visibleOptions = options.slice(0, visibleCount);
  const overflowOptions = options.slice(visibleCount);

  return (
    <>
      {visibleOptions.map((option) => <FilterLink active={option.active} href={option.href} key={option.value} label={option.label} />)}
      {overflowOptions.length > 0 ? (
        <details className="group contents" open={overflowOptions.some((option) => option.active)}>
          <summary className="order-last inline-flex min-h-8 cursor-pointer list-none items-center rounded-md px-2.5 text-sm font-medium text-primary hover:bg-primary/10 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">展开</span>
            <span className="hidden group-open:inline">折叠</span>
          </summary>
          {overflowOptions.map((option) => <FilterLink active={option.active} href={option.href} key={option.value} label={option.label} />)}
        </details>
      ) : null}
    </>
  );
}

function FilterSection({ label, moreHref, children }: { label: string; moreHref?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border py-3 last:border-b-0" aria-labelledby={`filter-${label}`}>
      <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-card px-3 py-1.5">
        <h3 className="m-0 font-display text-base font-normal" id={`filter-${label}`}>{label}</h3>
        {moreHref ? <Link className="shrink-0 text-xs font-semibold text-primary hover:text-accent" href={moreHref}>更多 →</Link> : null}
      </div>
      <div className="flex flex-wrap gap-x-1.5 gap-y-1">{children}</div>
    </section>
  );
}

function FilterLink({ active, href, label }: { active: boolean; href: string; label: string }) {
  return <Link aria-current={active ? "true" : undefined} className={active ? "inline-flex min-h-8 items-center rounded-full bg-accent px-2.5 text-sm font-bold text-white" : "inline-flex min-h-8 items-center rounded-md px-2.5 text-sm font-medium text-primary hover:bg-primary/10"} href={href}>{label}</Link>;
}

function FilterChip({ href, label }: { href: string; label: string }) {
  return <Link className="inline-flex min-h-8 items-center rounded-full border border-primary/30 bg-primary/5 px-2.5 text-xs font-bold text-primary hover:border-primary" href={href}>{label} <span className="ml-1" aria-hidden="true">×</span></Link>;
}

function gamesHref(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const text = query.toString();
  return text ? `/games?${text}` : "/games";
}

function parseOptionalId(value: string | null): number | null {
  if (!value) return null;
  try {
    return parsePositiveId(value);
  } catch {
    return null;
  }
}
