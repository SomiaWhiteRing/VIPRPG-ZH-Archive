import { lazy, Suspense } from "react";
import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { readHomePage } from "@/app/.server/home-page-data";
import { readTimelinePage } from "@/app/.server/timeline/page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { HomeWorkspace } from "@/app/components/home/home-workspace";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { translate } from "@/lib/i18n/core";

const TimelinePageContent = lazy(() => import("@/app/components/timeline/timeline-page-content")
  .then(({ TimelinePageContent }) => ({ default: TimelinePageContent })));

export async function loader({ url, context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const viewer = await getCurrentUser(runtime);
  if (viewer?.preferences.timelineAsHomepage) {
    return data({ mode: "timeline" as const, values: await readTimelinePage(runtime, url), locale: runtime.uiLocale }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return data({ mode: "explore" as const, values: await readHomePage(runtime), canonical: `${runtime.origin}/`, locale: runtime.uiLocale }, { headers: { "Cache-Control": "private, no-store" } });
}

export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors(loaderData?.mode === "timeline"
    ? { title: translate(locale, "core.nav.timeline") }
    : { alternates: { canonical: loaderData?.canonical } }, error, locale);
};

export default function HomePage() {
  const result = useLoaderData<typeof loader>();
  return result.mode === "timeline"
    ? (
      <Suspense fallback={<div aria-hidden className="min-h-dvh" />}>
        <TimelinePageContent values={result.values} basePath="/" />
      </Suspense>
    )
    : <HomeWorkspace {...result.values} />;
}
