import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { readHomePage } from "@/app/.server/home-page-data";
import { readTimelinePage } from "@/app/.server/timeline/page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { HomeWorkspace } from "@/app/components/home/home-workspace";
import { TimelinePageContent } from "@/app/components/timeline/timeline-page-content";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";

export async function loader({ url, context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const viewer = await getCurrentUser(runtime);
  if (viewer?.preferences.timelineAsHomepage) {
    return data({ mode: "timeline" as const, values: await readTimelinePage(runtime, url) }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return data({ mode: "explore" as const, values: await readHomePage(runtime), canonical: `${runtime.origin}/` }, { headers: { "Cache-Control": "private, no-store" } });
}

export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(loaderData?.mode === "timeline" ? { title: "时间线" } : { alternates: { canonical: loaderData?.canonical } }, error);

export default function HomePage() {
  const result = useLoaderData<typeof loader>();
  return result.mode === "timeline"
    ? <TimelinePageContent values={result.values} basePath="/" />
    : <HomeWorkspace {...result.values} />;
}
