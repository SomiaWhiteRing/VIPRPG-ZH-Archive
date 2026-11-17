import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { listTimeline } from "@/app/.server/db/timeline";
import { requirePublicUser } from "@/app/.server/public-user";
import { runtimeContext } from "@/app/.server/router-context";
import { TimelineWorkspace } from "@/app/components/timeline/timeline-workspace";
import { TIMELINE_FILTER_KINDS } from "@/lib/dto/db/timeline";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const user = await requirePublicUser(runtime, params.userId!);
  const viewer = await getCurrentUser(runtime);
  const query = new URL(request.url).searchParams;
  const kind = TIMELINE_FILTER_KINDS.find((value) => value === query.get("kind"));
  const cursor = query.has("kind") && !kind ? null : query.get("cursor");
  const page = await listTimeline(runtime, { actorUserId: user.id, viewerId: viewer?.id, cursor, kind });
  return data({ page, viewerId: viewer?.id ?? null, settings: null, kind, hasCursor: !!cursor, basePath: `/users/${user.id}/timeline`, displayName: user.displayName, locale: runtime.uiLocale }, { headers: { "Cache-Control": "private, no-store" } });
}

export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const title = translate(locale, "timeline.settings.title");
  return pageMetaDescriptors({ title: loaderData?.displayName ? [loaderData.displayName, title] : title }, error, locale);
};
export default function UserTimelinePage() {
  const t = useMessages();
  const values = useLoaderData<typeof loader>();
  return <section aria-label={t("timeline.settings.personal")}><TimelineWorkspace {...values} profile showAuthor={false} /></section>;
}

export { TimelineError as ErrorBoundary } from "@/app/components/timeline/timeline-error";
