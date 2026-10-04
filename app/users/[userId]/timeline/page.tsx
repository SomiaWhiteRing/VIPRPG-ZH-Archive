import { data, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { listTimeline } from "@/app/.server/db/timeline";
import { requirePublicUser } from "@/app/.server/public-user";
import { runtimeContext } from "@/app/.server/router-context";
import { TimelineWorkspace } from "@/app/components/timeline/timeline-workspace";
import { TIMELINE_KINDS, type TimelineKind } from "@/lib/dto/db/timeline";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const user = await requirePublicUser(runtime, params.userId!);
  const viewer = await getCurrentUser(runtime);
  const query = new URL(request.url).searchParams;
  const kind = TIMELINE_KINDS.find((value) => value === query.get("kind")) as TimelineKind | undefined;
  const cursor = query.get("cursor");
  const page = await listTimeline(runtime, { actorUserId: user.id, viewerId: viewer?.id, cursor, kind });
  return data({ page, viewerId: viewer?.id ?? null, settings: null, kind, hasCursor: !!cursor, basePath: `/users/${user.id}/timeline`, displayName: user.displayName }, { headers: { "Cache-Control": "private, no-store" } });
}

export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) => pageMetaDescriptors({ title: [loaderData?.displayName || "用户", "时间线"] }, error);
export default function UserTimelinePage() {
  const values = useLoaderData<typeof loader>();
  return <section aria-label="个人时间线"><TimelineWorkspace {...values} profile /></section>;
}

export { TimelineError as ErrorBoundary } from "@/app/components/timeline/timeline-error";
