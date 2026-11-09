import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { readInteractionRestrictions } from "@/app/.server/db/interaction-restrictions";
import { listDirectMessages } from "@/app/.server/db/messages";
import { parsePageId, throwNotFound } from "@/app/.server/http/page-response";
import { runtimeContext } from "@/app/.server/router-context";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { HttpError } from "@/lib/http";
import { MessageThread } from "../thread";
import type { PageLayoutHandle } from "@/app/components/use-page-layout";

export const handle = {
  androidLayout: { hideBackToTop: true, accountLayout: "standalone" },
} satisfies PageLayoutHandle;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const userId = parsePageId(args.params.userId ?? "");
  const user = await requireAccountUser(runtime, `/me/messages/${userId}`);
  try {
    const [initial, interactionRestrictions] = await Promise.all([
      listDirectMessages(runtime, user, userId),
      readInteractionRestrictions(runtime.db, user.id, userId),
    ]);
    return { viewerId: user.id, initial, interactionRestrictions };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throwNotFound();
    throw error;
  }
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: [loaderData?.initial.peer.displayName ?? "短信", "短信箱"] }, error);

export default function MessagePage() {
  const { viewerId, initial, interactionRestrictions } = useLoaderData<typeof loader>();
  return <MessageThread key={`${viewerId}:${initial.peer.id}`} viewerId={viewerId} initial={initial} interactionRestrictions={interactionRestrictions} />;
}
