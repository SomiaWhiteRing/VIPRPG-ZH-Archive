import { requireAccountUser } from "@/app/.server/auth/account-user";
import { translate } from "@/lib/i18n/core";
import { preserveUiLocale } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { inboxClosureReason, inboxItemBody, inboxItemTitle, maintainerOutcomeCopy, notificationExcerpt } from "../notification-copy";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import {
  getInboxItemForUser,
  inboxTargetLocation,
} from "@/app/.server/db/inbox";
import { redirectPage, throwNotFound } from "@/app/.server/http/page-response";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PageHeader } from "@/app/components/ui/page-header";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import { HttpError } from "@/lib/http";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { useRef } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { InboxActions } from "../actions";
import { useInboxAutoRead } from "../use-auto-read";
import { MaintainerRequestDetails } from '../maintainer-request-details';

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const { itemId } = await params;
  if (!/^[1-9]\d*$/.test(itemId) || !Number.isSafeInteger(Number(itemId)))
    throwNotFound();
  const user = await requireAccountUser(runtime, `/inbox/${itemId}`);
  const item = await getInboxItemForUser(runtime, Number(itemId), user).catch(
    (error: unknown) => {
      if (error instanceof HttpError && error.status === 404) throwNotFound();
      throw error;
    },
  );
  const location = await inboxTargetLocation(runtime, item);
  if (location) {
    const source = new URL(args.request.url);
    const target = preserveUiLocale(new URL(location.href, source), source);
    target.searchParams.set("inbox", String(item.id));
    redirectPage(target.pathname + target.search + target.hash);
  }

  return { item, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "header.inbox") }, error, locale);
};

export default function InboxTargetPage() {
  const t = useMessages();
  const { item } = useLoaderData<typeof loader>();
  const locale = useUiLocale();
  const outcome = maintainerOutcomeCopy(item, locale);
  const title = outcome?.title ?? inboxItemTitle(item, locale);
  const body = outcome?.body ?? inboxItemBody(item, locale);
  const closedReason = inboxClosureReason(item, locale);
  const contentNotification = item.timelineNotification ?? item.commentNotification;
  const contentRef = useRef<HTMLDivElement>(null);
  const { readAt, error } = useInboxAutoRead(item, contentRef);
  return (
    <main className="mx-auto w-[min(1280px,calc(100%-2rem))] py-8">
      <div id="inbox-controls" tabIndex={-1} className="mb-4">
        <Link to="/inbox" className="text-sm text-primary hover:underline">
          {t("inbox.back")}
        </Link>
      </div>
      <PageHeader compact title={t("header.inbox")} />
      <div ref={contentRef} className="min-w-0 wrap-anywhere py-6">
        {item.friendNotification ? <div className="flex min-w-0 items-center gap-3">
          <UserAvatar displayName={item.friendNotification.actorName} avatarBlobSha256={item.friendNotification.actorAvatar} size={40} className="size-10 shrink-0" />
          <p className="min-w-0 wrap-anywhere">
            {item.friendNotification.actorHref ? <Link to={item.friendNotification.actorHref} className="text-primary hover:underline">{item.friendNotification.actorName}</Link> : <span className="text-primary">{item.friendNotification.actorName}</span>}
            {item.friendNotification.actionKey ? t(item.friendNotification.actionKey) : item.friendNotification.action}
          </p>
        </div> : <p>{item.type.startsWith("forum_") ? t("inbox.contentUnavailable") : title}</p>}
        {item.maintainerRequest ? <MaintainerRequestDetails request={item.maintainerRequest} /> : null}
        {item.type === "role_change_request" ? <p className="mt-2 flex flex-wrap gap-x-2 text-sm text-muted">
          <span>{item.targetUserId ? <Link className="text-primary hover:underline" to={`/users/${item.targetUserId}`}>{item.targetDisplayName}</Link> : item.targetDisplayName}</span>
          {item.requestedRole?.name ? <span>{item.requestedRole.name}</span> : null}
        </p> : null}
        {contentNotification ? <>
          <Link to={contentNotification.href} className="mt-2 block text-primary hover:underline">{item.timelineNotification ? t("inbox.event.timelineTarget") : contentNotification.targetTitle}</Link>
          <p className="mt-2 whitespace-pre-wrap">{notificationExcerpt(contentNotification, locale)}</p>
        </> : null}
        {body ? <p className="mt-2 whitespace-pre-wrap">{body}</p> : null}
        {closedReason ? <p className="mt-2 text-muted">{closedReason}</p> : null}
        {item.rejectionReason ? <p className="mt-2 whitespace-pre-wrap wrap-anywhere"><span className="font-semibold">{t("inbox.rejectionReason")}</span>{item.rejectionReason}</p> : null}
      </div>
      <InboxActions
        item={{
          id: item.id,
          readAt,
          canApprove: item.canApprove,
          canReject: item.canReject,
          maintainerRequest: item.maintainerRequest,
          friendNotification: item.friendNotification,
          title,
          targetDisplayName: item.targetDisplayName,
        }}
      />
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("inbox.autoReadError")}
        </p>
      ) : null}
    </main>
  );
}

export { default as ErrorBoundary } from "@/app/inbox/error";
