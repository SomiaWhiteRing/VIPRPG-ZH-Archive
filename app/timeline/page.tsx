import { translate } from "@/lib/i18n/core";
import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { readTimelinePage } from "@/app/.server/timeline/page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { TimelinePageContent } from "@/app/components/timeline/timeline-page-content";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";

export async function loader({ url, context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  return data({ values: await readTimelinePage(runtime, url), locale: runtime.uiLocale }, { headers: { "Cache-Control": "private, no-store" } });
}

export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "timeline.settings.title") }, error, locale);
};

export default function TimelinePage() {
  return <TimelinePageContent values={useLoaderData<typeof loader>().values} basePath="/timeline" />;
}

export { TimelineError as ErrorBoundary } from "@/app/components/timeline/timeline-error";
