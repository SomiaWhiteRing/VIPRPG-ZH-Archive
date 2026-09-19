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
import { useRef } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { InboxActions } from "../actions";
import { useInboxAutoRead } from "../use-auto-read";

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
  const contentRef = useRef<HTMLDivElement>(null);
  const { readAt, error } = useInboxAutoRead(item, contentRef);
  return (
    <main className="mx-auto w-[min(1280px,calc(100%-2rem))] py-8">
      <div id="inbox-controls" tabIndex={-1} className="mb-4">
        <Link to="/inbox" className="text-sm text-primary hover:underline">
          返回提醒
        </Link>
      </div>
      <PageHeader compact title="提醒" />
      <div ref={contentRef} className="py-6">
        <p>{item.type.startsWith("forum_") ? "相关内容已不可用" : item.title}</p>
        {item.body ? <p className="mt-2 whitespace-pre-wrap">{item.body}</p> : null}
      </div>
      <InboxActions
        item={{
          id: item.id,
          readAt,
          canApprove: item.canApprove,
          canReject: item.canReject,
        }}
      />
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          自动标记已读失败，请手动标记已读。
        </p>
      ) : null}
    </main>
  );
}

export { default as ErrorBoundary } from "@/app/inbox/error";
