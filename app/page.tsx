import { listGameWorks } from "@/app/.server/db/game-library";
import { getForumRuntime } from "@/app/.server/forum/context";
import { publicTopicList } from "@/app/.server/forum/public-queries";
import { runtimeContext } from "@/app/.server/router-context";
import { GameCard } from "@/app/components/home/game-card";
import { HomeCommunity } from "@/app/components/home/home-community";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const [recentWorks, recentOriginalWorks, topics] = await Promise.all([
    listGameWorks(runtime, { limit: 12 }),
    listGameWorks(runtime, { limit: 4, isOriginal: true }),
    publicTopicList(getForumRuntime(runtime), {
      tags: [],
      featured: false,
      page: 1,
    }),
  ]);

  return { recentWorks, recentOriginalWorks, topics };
}

export default function HomePage() {
  const { recentWorks, recentOriginalWorks, topics } =
    useLoaderData<typeof loader>();
  return (
    <PageContainer>
      <div className="grid gap-7 min-[561px]:gap-8 min-[851px]:grid-cols-[minmax(0,1fr)_205px] min-[851px]:gap-6 min-[1101px]:grid-cols-[minmax(0,1fr)_237px] min-[1101px]:gap-9">
        <section
          className="min-w-0 scroll-mt-24"
          id="recent-updates"
          aria-labelledby="recent-heading"
        >
          <PageHeader
            compact
            title="最近更新"
            titleId="recent-heading"
            subtitle="最近更新的公开游戏。"
            actions={
              <Link
                className="shrink-0 text-sm font-bold text-primary hover:text-accent"
                to="/games"
              >
                查看全部游戏 →
              </Link>
            }
          />
          <div className="mt-5">
            <HomeWorkGrid works={recentWorks} />
          </div>
        </section>

        <HomeCommunity topics={topics.items.slice(0, 5)} />
      </div>

      <section
        className="mt-7 grid gap-4 border-t-2 border-foreground pt-5 min-[561px]:mt-8 min-[561px]:gap-5 min-[561px]:pt-6 min-[851px]:mt-11 min-[851px]:grid-cols-[135px_minmax(0,1fr)] min-[851px]:gap-6 min-[1101px]:grid-cols-[170px_minmax(0,1fr)] min-[1101px]:gap-8 scroll-mt-24"
        id="recent-original"
        aria-labelledby="original-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-3 min-[851px]:block">
          <div>
            <h2
              className="text-2xl font-bold tracking-tight"
              id="original-heading"
            >
              最近原创
            </h2>
            <p className="mt-1 text-muted">由作者亲自在本站发表的游戏。</p>
          </div>
          <Link
            className="ml-auto shrink-0 text-sm font-bold text-primary hover:text-accent min-[851px]:mt-5 min-[851px]:inline-block"
            to="/games?original=1"
          >
            查看全部游戏 →
          </Link>
        </div>
        <HomeWorkGrid original works={recentOriginalWorks} />
      </section>
    </PageContainer>
  );
}

function HomeWorkGrid({
  works,
  original = false,
}: {
  works: Awaited<ReturnType<typeof listGameWorks>>;
  original?: boolean;
}) {
  if (!works.length) {
    return (
      <EmptyState
        title={original ? "目前还没有公开原创作品。" : "目前还没有公开作品。"}
        variant="plain"
        className="py-6"
      />
    );
  }

  return (
    <div className="@container min-w-0">
      <div
        className={`grid grid-cols-2 gap-x-2.5 gap-y-3 @min-[609px]:grid-cols-3 @min-[609px]:gap-3.5 @min-[889px]:grid-cols-4 @min-[889px]:gap-4 ${
          original
            ? "@max-[609px]:[&>*:nth-child(n+3)]:hidden @max-[889px]:[&>*:nth-child(n+4)]:hidden"
            : "@max-[609px]:[&>*:nth-child(n+7)]:hidden @max-[889px]:[&>*:nth-child(n+10)]:hidden"
        }`}
      >
        {works.map((work) => (
          <GameCard key={work.id} work={work} />
        ))}
      </div>
    </div>
  );
}
