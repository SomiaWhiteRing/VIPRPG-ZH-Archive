import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { listHomeGameWorks } from "@/app/.server/db/game-library";
import { getForumRuntime } from "@/app/.server/forum/context";
import { homeTopics } from "@/app/.server/forum/public-queries";
import type { GameCardSummary } from "@/lib/dto/db/game-library";
import { runtimeContext } from "@/app/.server/router-context";
import { GameCard } from "@/app/components/home/game-card";
import { HomeCommunity } from "@/app/components/home/home-community";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { useToast } from "@/app/components/ui/toast";
import { useEffect, useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const [works, topics] = await Promise.all([
    listHomeGameWorks(runtime),
    homeTopics(getForumRuntime(runtime)),
  ]);

  return { ...works, topics, canonical: `${runtime.origin}/` };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ alternates: { canonical: loaderData?.canonical } }, error);

export default function HomePage() {
  const { recentWorks, recentOriginalWorks, randomWorks, topics } =
    useLoaderData<typeof loader>();
  const [randomSelection, setRandomSelection] = useState(randomWorks);
  const [randomBusy, setRandomBusy] = useState(false);
  const toast = useToast();
  useEffect(() => setRandomSelection(randomWorks), [randomWorks]);

  async function refreshRandomWorks() {
    if (randomBusy) return;
    setRandomBusy(true);
    try {
      const response = await fetch("/api/works/random");
      const result = await response.json() as { ok: boolean; works: GameCardSummary[]; detail?: string };
      if (!response.ok || !result.ok) throw new Error(result.detail ?? "随机作品加载失败，请稍后重试。");
      setRandomSelection(result.works);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "随机作品加载失败，请稍后重试。");
    } finally {
      setRandomBusy(false);
    }
  }
  return (
    <PageContainer>
      <div className="flex flex-col gap-7 min-[561px]:gap-8 min-[851px]:flex-row min-[851px]:gap-6 min-[1101px]:gap-9">
        <section
          className="min-w-0 flex-1 scroll-mt-24"
          id="recent-updates"
          aria-labelledby="recent-heading"
        >
          <PageHeader
            compact
            title="最近更新"
            titleId="recent-heading"
            actions={
              <Link
                className="shrink-0 text-sm font-bold text-primary hover:text-accent"
                to="/games"
              >
                查看全部 →
              </Link>
            }
          />
          <div className="mt-5">
            <HomeWorkGrid works={recentWorks} prioritizeImages titleAs="h2" />
          </div>
        </section>

        <HomeCommunity topics={topics} />
      </div>

      <section
        className="mt-7 flex flex-col gap-4 border-t-2 border-foreground pt-5 min-[561px]:mt-8 min-[561px]:gap-5 min-[561px]:pt-6 min-[851px]:mt-11 min-[851px]:flex-row min-[851px]:gap-6 min-[1101px]:gap-8 scroll-mt-24"
        id="recent-original"
        aria-labelledby="original-heading"
      >
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 min-[851px]:block min-[851px]:w-[135px] min-[1101px]:w-[170px]">
          <div>
            <h2
              className="text-2xl font-bold tracking-tight"
              id="original-heading"
            >
              最近原创
            </h2>
          </div>
          <Link
            className="ml-auto shrink-0 text-sm font-bold text-primary hover:text-accent min-[851px]:mt-5 min-[851px]:inline-block"
            to="/games?original=1"
          >
            查看全部 →
          </Link>
        </div>
        <div className="min-w-0 flex-1">
          <HomeWorkGrid original works={recentOriginalWorks} />
        </div>
      </section>

      <section
        className="mt-7 flex flex-col gap-4 border-t-2 border-foreground pt-5 min-[561px]:mt-8 min-[561px]:gap-5 min-[561px]:pt-6 min-[851px]:mt-11 min-[851px]:flex-row min-[851px]:gap-6 min-[1101px]:gap-8 scroll-mt-24"
        id="random-works"
        aria-labelledby="random-heading"
      >
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 min-[851px]:block min-[851px]:w-[135px] min-[1101px]:w-[170px]">
          <div>
            <h2
              className="text-2xl font-bold tracking-tight"
              id="random-heading"
            >
              随机作品
            </h2>
          </div>
          <Button
            variant="ghost"
            className="ml-auto min-h-0 rounded-none p-0 font-bold text-primary hover:bg-transparent hover:text-accent min-[851px]:mt-5"
            type="button"
            disabled={randomBusy}
            aria-controls="random-work-grid"
            onClick={() => void refreshRandomWorks()}
          >
            试试手气
          </Button>
        </div>
        <div
          className="min-w-0 flex-1"
          id="random-work-grid"
          aria-busy={randomBusy}
        >
          <HomeWorkGrid singleRow works={randomSelection} />
        </div>
      </section>
    </PageContainer>
  );
}

function HomeWorkGrid({
  works,
  original = false,
  singleRow = false,
  prioritizeImages = false,
  titleAs = "h3",
}: {
  works: GameCardSummary[];
  original?: boolean;
  singleRow?: boolean;
  prioritizeImages?: boolean;
  titleAs?: "h2" | "h3";
}) {
  if (!works.length) {
    return (
      <EmptyState
        title={original ? "目前还没有公开的原创作品。" : "目前还没有公开的作品。"}
        variant="plain"
        className="py-6"
      />
    );
  }

  return (
    <div className="@container min-w-0">
      <div
        className={`grid grid-cols-2 gap-x-2.5 gap-y-3 @min-[609px]:grid-cols-3 @min-[609px]:gap-3.5 @min-[889px]:grid-cols-4 @min-[889px]:gap-4 ${
          original || singleRow
            ? "@min-[609px]:@max-[889px]:[&>*:nth-child(n+4)]:hidden"
            : "@max-[609px]:[&>*:nth-child(n+7)]:hidden @max-[889px]:[&>*:nth-child(n+10)]:hidden"
        }`}
      >
        {works.map((work, index) => (
          <GameCard
            key={work.id}
            work={work}
            imagePriority={prioritizeImages && index < 4}
            titleAs={titleAs}
          />
        ))}
      </div>
    </div>
  );
}
