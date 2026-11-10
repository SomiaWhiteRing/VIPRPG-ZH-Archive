import { listHomeGameWorks } from "@/app/.server/db/game-library";
import { getForumRuntime } from "@/app/.server/forum/context";
import { homeTopics } from "@/app/.server/forum/public-queries";
import type { AppRuntime } from "@/app/.server/runtime";

export async function readHomePage(runtime: AppRuntime) {
  const [works, topics] = await Promise.all([
    listHomeGameWorks(runtime),
    homeTopics(getForumRuntime(runtime)),
  ]);
  return { ...works, topics };
}

export type HomePageData = Awaited<ReturnType<typeof readHomePage>>;
