import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { readTimelinePage } from "@/app/.server/timeline/page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { TimelinePageContent } from "@/app/components/timeline/timeline-page-content";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";

export async function loader({ url, context }: LoaderFunctionArgs) {
  return data(await readTimelinePage(context.get(runtimeContext), url), { headers: { "Cache-Control": "private, no-store" } });
}

export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction = ({ error }) => pageMetaDescriptors({ title: "时间线" }, error);

export default function TimelinePage() {
  return <TimelinePageContent values={useLoaderData<typeof loader>()} basePath="/timeline" />;
}

export { TimelineError as ErrorBoundary } from "@/app/components/timeline/timeline-error";
