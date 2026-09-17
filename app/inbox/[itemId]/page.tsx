import { getCurrentUser } from "@/app/.server/auth/current-user";
import {
  getInboxItemForUser,
  inboxTargetLocation,
} from "@/app/.server/db/inbox";
import { redirectPage, throwNotFound } from "@/app/.server/http/page-response";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PageHeader } from "@/app/components/ui/page-header";
import { HttpError } from "@/lib/http";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { InboxActions } from "../actions";
import { InboxFeedback } from "../controls";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const { itemId } = await params;
  if (!/^[1-9]\d*$/.test(itemId) || !Number.isSafeInteger(Number(itemId)))
    throwNotFound();
  const user = await getCurrentUser(runtime);
  if (!user)
    redirectPage(`/login?next=${encodeURIComponent(`/inbox/${itemId}`)}`);
  const item = await getInboxItemForUser(runtime, Number(itemId), user).catch(
    (error: unknown) => {
      if (error instanceof HttpError && error.status === 404) throwNotFound();
      throw error;
    },
  );
  const location = await inboxTargetLocation(runtime, item);
  if (location) {
    const [path, hash] = location.href.split("#");
    redirectPage(
      `${path}${path.includes("?") ? "&" : "?"}inbox=${item.id}${hash ? `#${hash}` : ""}`,
    );
  }

  return { item };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: "提醒" }, error);

export default function InboxTargetPage() {
  const { item } = useLoaderData<typeof loader>();
  return (
    <main className="mx-auto w-[min(1280px,calc(100%-2rem))] py-8">
      <div id="inbox-controls" tabIndex={-1} className="mb-4">
        <Link to="/inbox" className="text-sm text-primary hover:underline">
          返回提醒
        </Link>
      </div>
      <PageHeader compact title="提醒" />
      <InboxFeedback />
      <p className="py-6">
        {item.type.startsWith("forum_") ? "相关内容已不可用" : item.title}
      </p>
      <InboxActions
        item={{
          id: item.id,
          readAt: item.readAt,
          canApprove: item.canApprove,
          canReject: item.canReject,
        }}
      />
    </main>
  );
}

export { default as ErrorBoundary } from "@/app/inbox/error";
