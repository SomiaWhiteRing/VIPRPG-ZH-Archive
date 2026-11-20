import {
  parseAccountPage,
  requireAccountUser,
} from "@/app/.server/auth/account-user";
import { searchUploadedWorks } from "@/app/.server/db/game-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AccountEmpty } from "@/app/components/profile/account-content";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { Button } from "@/app/components/ui/button";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { Badge } from '@/app/components/ui/badge';
import { WorkThumbnail } from "@/app/components/work/work-thumbnail";
import {
  canAccessOwnWorks,
  canPublishWork,
  hasPermission,
} from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { formatDate, parseTimestamp } from "@/lib/format";
import { engineLabel, languageLabel } from "@/lib/labels";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const page = parseAccountPage((await searchParams).page);
  const user = await requireAccountUser(
    runtime,
    `/me/uploads${page > 1 ? `?page=${page}` : ""}`,
  );
  if (!canAccessOwnWorks(user)) throwNotFound();
  const result = await searchUploadedWorks(runtime, {
    userId: user.id,
    page,
    pageSize: 20,
  });

  return {
    page,
    locale: runtime.uiLocale,
    user: pickPageFields(user, ["id", "status", "permissionKeys"]),
    result,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "account.nav.uploads"), page: loaderData?.page }, error, locale);
};

export default function UploadsPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const { page, user, result } = useLoaderData<typeof loader>();
  return (
    <div>
      <AccountPageHeader
        actions={
          canPublishWork(user) ? (
            <Button asChild variant="rm2k"><Link to="/upload">{t("upload.own.new")}</Link></Button>
          ) : undefined
        }
        subtitle={t("upload.own.count", { count: result.total })}
        title={t("account.nav.uploads")}
      />
      {result.items.length ? (
        <ul className="divide-y divide-border border-b border-border">
          {result.items.map((work) => (
            <li
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
              key={work.id}
            >
              <Link
                aria-label={t(work.status === "processing" ? "upload.own.editNamed" : "upload.own.viewNamed", { title: work.chineseTitle || work.originalTitle })}
                className="row-span-2 block aspect-4/3 w-26 self-start overflow-hidden rounded-md border border-border bg-muted/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:row-span-1 sm:w-32"
                to={work.status === "processing" ? `/me/uploads/${work.id}` : `/games/${work.id}`}
              >
                <WorkThumbnail
                  blobSha256={work.coverBlobSha256}
                  width={128}
                  height={96}
                  fallback={t("work.noCover")}
                  fallbackClassName="flex h-full items-center justify-center px-1 text-center font-mono text-xs text-muted"
                />
              </Link>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="truncate font-semibold"
                    to={work.status === "processing" ? `/me/uploads/${work.id}` : `/games/${work.id}`}
                  >
                    {work.chineseTitle || work.originalTitle}
                  </Link>
                  <StatusBadge kind="publication" value={work.status} />
                  {hasPermission(user, 'work.update_own') && work.pendingMaintainerRequests > 0 ? (
                    <Link to="/inbox?category=pending" className="hover:underline"><Badge variant="outline">{t("upload.own.pending", { count: work.pendingMaintainerRequests })}</Badge></Link>
                  ) : null}
                </div>
                {work.chineseTitle ? (
                  <p className="mt-1 truncate text-sm text-muted">
                    {work.originalTitle}
                  </p>
                ) : null}
                <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted">
                  <span>{engineLabel(work.engineFamily, locale)}</span>
                  <span>{languageLabel(work.language, locale)}</span>
                </p>
                <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-muted">
                  {work.publishedAt
                    ? <span>{t("upload.own.publishedAt", { date: formatDate(work.publishedAt, { locale }) })}</span>
                    : null}
                  {!work.publishedAt ||
                  parseTimestamp(work.updatedAt).getTime() !==
                    parseTimestamp(work.publishedAt).getTime()
                    ? <span>{t("upload.own.updatedAt", { date: formatDate(work.updatedAt, { locale }) })}</span>
                    : null}
                </p>
              </div>
              <div className="col-start-2 flex flex-wrap gap-2 sm:col-start-3">
                {hasPermission(user, "work.update_own") ? (
                  <Button
                    asChild
                    variant="default"
                    size="sm"
                    className="px-3 text-xs"
                  >
                    <Link to={`/me/uploads/${work.id}`}>{t("upload.own.editDetails")}</Link>
                  </Button>
                ) : null}
                {work.status === "processing" && hasPermission(user, "work.update_own") ? (
                  <ConfirmingForm
                    action={`/api/works/${work.id}/delete`}
                    confirmField="confirm"
                    title={t("upload.own.deleteRecordConfirm")}
                    description={t("upload.own.deleteRecordDescription")}
                  >
                    <input name="confirm" type="hidden" value="delete" />
                    <Button type="submit" variant="destructive" size="sm" className="px-3 text-xs">
                      {t("upload.own.deleteRecord")}
                    </Button>
                  </ConfirmingForm>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <AccountEmpty>{t("upload.own.empty")}</AccountEmpty>
      )}
      <PaginationLinks
        basePath="/me/uploads"
        page={page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
