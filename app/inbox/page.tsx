import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { inboxClosureReason, inboxItemBody, inboxItemTitle, maintainerOutcomeCopy, notificationExcerpt } from "./notification-copy";
import { translate } from "@/lib/i18n/core";
import { preserveUiLocale } from "@/lib/i18n/locale";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { Timestamp } from "@/app/components/ui/timestamp";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import {
  canResolveInboxRequests,
  listInboxItemsForUser,
} from "@/app/.server/db/inbox";
import { redirectPage } from "@/app/.server/http/page-response";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Badge } from "@/app/components/ui/badge";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import type { InboxItem } from "@/lib/dto/db/inbox";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { formatUnreadCount } from "@/lib/format";
import { forumPage } from "@/lib/forum";
import type { InboxCategory } from "@/lib/inbox";
import { inboxCategory, inboxHref } from "@/lib/inbox";
import { Bell, MessageCircle, ShieldCheck, ThumbsUp } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { InboxActions } from "./actions";
import { InboxControls } from "./controls";
import { useInboxAutoRead } from "./use-auto-read";
import { canReviewWorkMaintainerRequests } from '@/app/.server/db/work-maintainers';
import { MaintainerRequestDetails } from './maintainer-request-details';
import { hasPermission } from "@/lib/authz/permissions";
import { webPushConfiguration } from "@/app/.server/push/service";
import { WebPushSettings } from "./web-push-settings";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const params = await searchParams;
  const category = inboxCategory(params.category);
  const page = forumPage(params.page);
  const currentUser = await requireAccountUser(runtime, inboxHref(category, page));
  const source = new URL(args.request.url);
  const canResolve = canResolveInboxRequests(currentUser) || hasPermission(currentUser, "forum.content.moderate_any") || await canReviewWorkMaintainerRequests(runtime, currentUser);
  if (category === "pending" && !canResolve)
    redirectToInbox(source, "all");
  const result = await listInboxItemsForUser(runtime, currentUser, {
    category,
    page,
  });
  if (page !== result.page)
    redirectToInbox(source, category, result.page);

  return { locale: runtime.uiLocale, category, canResolve, result, userId: currentUser.id, preferences: currentUser.preferences,
    pushPublicKey: webPushConfiguration(runtime.env)?.publicKey ?? null };
}

function redirectToInbox(source: URL, category: InboxCategory, page?: number): never {
  const target = preserveUiLocale(new URL(inboxHref(category, page), source), source);
  return redirectPage(target.pathname + target.search);
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "header.inbox"), page: loaderData?.result.page }, error, locale);
};

export default function InboxPage() {
  const t = useMessages();
  const { category, canResolve, result, userId, preferences, pushPublicKey } =
    useLoaderData<typeof loader>();
  const [autoRead, setAutoRead] = useState({ result, ids: new Set<number>() });
  const onRead = useCallback(
    (itemId: number) => {
      setAutoRead((previous) => ({
        result,
        ids: new Set(previous.result === result ? previous.ids : []).add(itemId),
      }));
    },
    [result],
  );
  const unreadCount = Math.max(
    0,
    result.unread -
      result.items.filter(
        (item) =>
          !item.readAt &&
          autoRead.result === result &&
          autoRead.ids.has(item.id),
      ).length,
  );
  return (
    <PageContainer>
      <PageHeader
        compact
        title={
          <span>
            {t("header.inbox")}
            {unreadCount > 0 ? (
              <span className="ml-3 align-middle font-sans text-sm font-normal text-muted">
                {t("inbox.unreadCount", { count: formatUnreadCount(unreadCount) })}
              </span>
            ) : null}
          </span>
        }
        actions={
          // Match the compact title's mobile line height (24px × 1.2).
          <div className="flex h-[28.8px] items-center gap-3 sm:h-9">
            <WebPushSettings key={userId} userId={userId} publicKey={pushPublicKey} preferences={preferences} />
          </div>
        }
      />
      <InboxControls
        category={category}
        pendingCount={result.pending}
        canResolve={canResolve}
        actions={unreadCount > 0 ? <InboxActions all /> : null}
      />
      {result.items.length ? (
        <ul
          aria-label={t("inbox.list")}
          className="divide-y divide-border border-b border-border"
        >
          {result.items.map((item) => (
            <InboxRow key={item.id} item={item} onRead={onRead} />
          ))}
        </ul>
      ) : (
        <EmptyState
          title={t(`inbox.empty.${category}`)}
        />
      )}
      <PaginationLinks
        basePath="/inbox"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        prefetch={false}
        params={{ category: category === "all" ? undefined : category }}
      />
    </PageContainer>
  );
}

function InboxRow({
  item,
  onRead,
}: {
  item: InboxItem;
  onRead: (itemId: number) => void;
}) {
  const t = useMessages();
  const rowRef = useRef<HTMLLIElement>(null);
  const locale = useUiLocale();
  const outcome = maintainerOutcomeCopy(item, locale);
  const title = outcome?.title ?? inboxItemTitle(item, locale);
  const body = outcome?.body ?? inboxItemBody(item, locale);
  const closedReason = inboxClosureReason(item, locale);
  const { readAt, error } = useInboxAutoRead(item, rowRef, onRead);
  const interaction = item.interaction;
  const contentNotification = item.timelineNotification ?? item.commentNotification;
  const actor = interaction ?? item.friendNotification ?? contentNotification;
  const avatar = interaction ?? item.friendNotification ?? contentNotification;
  const Icon =
    item.type === "forum_like" || contentNotification?.kind === "like"
      ? ThumbsUp
      : item.type === "forum_reply" || contentNotification
        ? MessageCircle
        : item.type === "role_change_request"
          ? ShieldCheck
          : Bell;
  const approvalLabels = {
    pending: t("inbox.review"),
    approved: t("inbox.approved"),
    rejected: t("inbox.rejected"),
    open: t("inbox.review"),
    archived: t("inbox.closed"),
  };
  return (
    <li
      ref={rowRef}
      className={`grid min-w-0 grid-cols-[36px_minmax(0,1fr)] gap-x-3 gap-y-2 px-2 py-4 hover:bg-primary/5 focus-within:bg-primary/5 sm:grid-cols-[36px_minmax(0,1fr)_auto] sm:px-3 ${readAt ? "" : "bg-primary/[0.03]"}`}
    >
      <div className="relative row-span-2 self-start">
        {avatar ? (
          <UserAvatar
            displayName={avatar.actorName}
            avatarBlobSha256={avatar.actorAvatar}
            size={36}
            className="size-9"
          />
        ) : (
          <span className="grid size-9 place-items-center rounded-md bg-muted/10">
            <Icon className="size-4 text-muted" aria-hidden />
          </span>
        )}
        {!readAt ? (
          <span className="absolute -left-1 -top-1 size-2 rounded-full bg-primary">
            <span className="sr-only">{t("inbox.unread")}</span>
          </span>
        ) : null}
      </div>
      <div className="min-w-0 break-words [overflow-wrap:anywhere]">
        <p className={`text-sm ${readAt ? "" : "font-semibold"}`}>
          {actor ? (
            <>
              {actor.actorHref ? (
                <Link
                  className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                  to={actor.actorHref}
                >
                  {actor.actorName}
                </Link>
              ) : (
                <span className="text-primary">{actor.actorName}</span>
              )}
              <span>{actor.actionKey ? t(actor.actionKey) : actor.action}</span>
            </>
          ) : item.windyDay || item.windyErrorKind ? <Link className="text-primary" to={`/inbox/${item.id}`}>{item.windyDay ? t("windy.day.notice",{day:item.windyDay}) : t("windy.notice")}</Link> : item.contentUnavailable ? t("inbox.contentUnavailable") : title}
        </p>
        {interaction ? (
          <>
            <Link
              to={`/inbox/${item.id}`}
              prefetch="none"
              className="mt-1 block rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="line-clamp-2 font-semibold text-primary hover:underline">
                {interaction.topicTitle}
              </span>
              <span className="mt-1 block text-xs text-muted">
                {t("comment.floor", { floor: interaction.postNumber })}
                {interaction.commentId ? ` · ${t("forum.nestedSuffix")}` : ""}
              </span>
              {interaction.excerpt ? (
                <span className="mt-2 line-clamp-2 text-foreground">
                  {interaction.excerpt}
                </span>
              ) : null}
            </Link>
          </>
        ) : (
          <>
            {contentNotification ? (
              <Link to={`/inbox/${item.id}`} prefetch="none" className="mt-1 block rounded-sm text-sm focus-visible:outline-2 focus-visible:outline-primary">
                <span className="line-clamp-2 font-semibold text-primary hover:underline">{item.timelineNotification ? t("inbox.event.timelineTarget") : contentNotification.targetTitle}</span>
                <span className="mt-2 line-clamp-2 text-foreground">{notificationExcerpt(contentNotification, locale)}</span>
              </Link>
            ) : null}
            {item.type === "role_change_request" ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>
                  {item.targetUserId ? <Link className="text-primary hover:underline" to={`/users/${item.targetUserId}`}>{item.targetDisplayName}</Link> : item.targetDisplayName} · {item.requestedRole?.name}
                </span>
                <Badge variant="outline">{approvalLabels[item.status]}</Badge>
              </div>
            ) : null}
            {item.maintainerRequest ? <MaintainerRequestDetails request={item.maintainerRequest} /> : null}
            {item.report ? <Link className="mt-1 block text-sm text-primary hover:underline" to={item.report.kind === "message" ? `/admin/discussions/messages/${item.report.id}` : `/admin/discussions?view=reports&q=${item.report.targetId ?? ""}`}>{t("inbox.report")}</Link> : null}
            {body ? (
              <p className="mt-2 whitespace-pre-wrap text-sm">{body}</p>
            ) : null}
            {closedReason ? <p className="mt-2 text-sm text-muted">{closedReason}</p> : null}
            {item.rejectionReason ? <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm"><span className="font-semibold">{t("inbox.rejectionReason")}</span>{item.rejectionReason}</p> : null}
          </>
        )}
      </div>
      <Timestamp
        value={item.createdAt}
        className="col-start-2 text-muted sm:col-start-3 sm:row-start-1 sm:text-right"
      />
      <div className="col-start-2 min-h-9 sm:col-start-3 sm:row-start-2">
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
      </div>
    </li>
  );
}
