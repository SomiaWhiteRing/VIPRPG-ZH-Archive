import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { listRootComments } from "@/app/.server/db/work-community";
import { CommentPanel } from "@/app/components/comments/comment-panel";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import {
  getCatalogById,
  searchCatalogsForOwner,
} from "@/app/.server/db/catalogs";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { CatalogItemsSection } from "@/app/catalogs/catalog-items-section";
import { EmptyState } from "@/app/components/ui/empty-state";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { formatDate, formatNumber } from "@/lib/format";
import { useEffect, useState, type ReactNode } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { CatalogSummaryEditor } from "../catalog-manager";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const id = parsePositiveId((await params).id, "catalog id");
  const [catalog, currentUser] = await Promise.all([
    getCatalogById(runtime, id),
    getCurrentUser(runtime),
  ]);
  if (!catalog) throwNotFound();

  const [ownerCatalogs, comments, commentCount] = await Promise.all([
    searchCatalogsForOwner(runtime, { userId: catalog.ownerUserId, pageSize: 6 }),
    listRootComments(runtime, { kind: "catalog", id }, currentUser?.id ?? null, null),
    runtime.db.prepare("SELECT COUNT(*) AS count FROM published_comments WHERE catalog_id=?")
      .bind(id).first<{ count: number }>(),
  ]);
  const otherCatalogs = ownerCatalogs.items
    .filter((item) => item.id !== catalog.id)
    .slice(0, 5);
  const canManageAny = Boolean(
    currentUser && hasPermission(currentUser, "catalog.manage_any"),
  );
  const ownsCatalog = Boolean(
    currentUser && catalog.ownerUserId === currentUser.id,
  );
  const canEditSummary =
    canManageAny ||
    Boolean(ownsCatalog && hasPermission(currentUser, "catalog.update_own"));
  const canDelete =
    canManageAny ||
    Boolean(ownsCatalog && hasPermission(currentUser, "catalog.delete_own"));
  const canEditItems =
    canManageAny ||
    Boolean(ownsCatalog && hasPermission(currentUser, "catalog.reorder_own"));

  return {
    locale: runtime.uiLocale,
    catalog,
    currentUser: pickPageFields(currentUser, ["id"]),
    otherCatalogs,
    comments,
    commentCount: commentCount?.count ?? 0,
    canEditSummary,
    canDelete,
    canEditItems,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: loaderData?.catalog.title || translate(locale, "catalog.detail") }, error, locale);
};

export default function CatalogPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const {
    catalog: initialCatalog,
    currentUser,
    otherCatalogs,
    canEditSummary,
    canDelete,
    canEditItems,
    comments,
    commentCount,
  } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [snapshot, setSnapshot] = useState({ source: initialCatalog, catalog: initialCatalog });
  const catalog = snapshot.source === initialCatalog ? snapshot.catalog : initialCatalog;
  const updateCatalog = (next: typeof catalog) => setSnapshot({ source: initialCatalog, catalog: next });
  useEffect(() => {
    const title = pageMetaDescriptors({ title: catalog.title }).find((descriptor) => "title" in descriptor);
    if (title && "title" in title && typeof title.title === "string") document.title = title.title;
  }, [catalog.title]);
  return (
    <main
      key={`${catalog.id}:${currentUser?.id ?? "anonymous"}`}
      className="mx-auto min-w-0 w-[min(1280px,calc(100vw-2rem))] wrap-anywhere py-5 sm:py-8"
    >
      <div className="mt-5 flex flex-col gap-8 min-[981px]:flex-row">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-[clamp(26px,4vw,36px)] font-bold leading-tight">
            {catalog.title}
          </h1>
          <section
            aria-label={t("catalog.summary")}
            className="mt-4 rounded-lg border border-border bg-muted/5 p-4 sm:p-5"
          >
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="relative flex aspect-4/3 w-full shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-card font-mono text-xs text-muted sm:w-52">
                {catalog.coverBlobSha256 ? (
                  <img
                    alt=""
                    className="h-full w-full object-cover"
                    height={156}
                    src={`/api/media/blobs/${catalog.coverBlobSha256}`}
                    width={208}
                    loading="lazy"
                  />
                ) : (
                  <span>{t("work.noCover")}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="m-0 whitespace-pre-wrap text-sm leading-[1.75]">
                  {catalog.description || t("catalog.detailNoDescription")}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-xs text-muted">
              <span>
                {t("catalog.creator")}
                <Link
                  className="font-semibold text-primary hover:underline"
                  to={`/users/${catalog.ownerUserId}`}
                >
                  {catalog.ownerName}
                </Link>
              </span>
              <span>
                {t("catalog.createdAt")}{" "}
                <time className="font-mono" dateTime={catalog.createdAt}>
                  {formatDate(catalog.createdAt, { locale })}
                </time>
              </span>
              <span>
                {t("catalog.updatedAt")}{" "}
                <time className="font-mono" dateTime={catalog.updatedAt}>
                  {formatDate(catalog.updatedAt, { locale })}
                </time>
              </span>
              <span className="font-mono">
                {t("favorite.workCount", { count: catalog.itemCount })}
              </span>
              {canEditSummary || canDelete ? (
                <div className="ml-auto">
                  <CatalogSummaryEditor
                    canDelete={canDelete}
                    canEdit={canEditSummary}
                    catalog={catalog}
                    onSaved={updateCatalog}
                  />
                </div>
              ) : null}
            </div>
          </section>

          <CatalogItemsSection
            canEdit={canEditItems}
            catalogId={catalog.id}
            items={catalog.items}
            onSaved={updateCatalog}
          />
          <section aria-labelledby="comments-title" className="mt-8 scroll-mt-28 border-t border-border py-4.5" id="sec-comments">
            <h2 className="mb-4 text-base font-bold" id="comments-title">{t("discussion.tabComments", { count: commentCount })}</h2>
            <CommentPanel
              target={{ kind: "catalog", id: catalog.id }}
              currentUserId={currentUser?.id ?? null}
              initialComments={comments.items}
              initialTotal={comments.total}
              onChanged={() => { void revalidator.revalidate(); }}
            />
          </section>
        </div>

        <aside
          aria-label={t("catalog.sidebar")}
          className="w-full shrink-0 space-y-5 min-[981px]:sticky min-[981px]:top-20 min-[981px]:w-72 min-[981px]:self-start"
        >
          <SidebarPanel title={t("catalog.overview")}>
            <div className="flex items-end gap-2">
              <strong className="font-display text-3xl leading-none">
                {formatNumber(catalog.itemCount, locale)}
              </strong>
              <span className="text-sm text-muted">{t("catalog.worksUnit")}</span>
            </div>
            <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-border pt-3 text-xs">
              <dt className="text-muted">{t("catalog.owner")}</dt>
              <dd className="m-0 min-w-0">
                <Link
                  className="font-semibold text-primary hover:underline"
                  to={`/users/${catalog.ownerUserId}`}
                >
                  {catalog.ownerName}
                </Link>
              </dd>
              <dt className="text-muted">{t("catalog.createdTime")}</dt>
              <dd className="m-0 font-mono">
                <time dateTime={catalog.createdAt}>
                  {formatDate(catalog.createdAt, { locale })}
                </time>
              </dd>
              <dt className="text-muted">{t("catalog.updatedTime")}</dt>
              <dd className="m-0 font-mono">
                <time dateTime={catalog.updatedAt}>
                  {formatDate(catalog.updatedAt, { locale })}
                </time>
              </dd>
            </dl>
          </SidebarPanel>

          <SidebarPanel title={t("catalog.other")}>
            {otherCatalogs.length ? (
              <ul className="m-0 list-none divide-y divide-border p-0">
                {otherCatalogs.map((item) => (
                  <li className="py-2.5 first:pt-0 last:pb-0" key={item.id}>
                    <Link
                      className="block text-sm font-semibold leading-5 hover:text-primary hover:underline"
                      to={`/catalogs/${item.id}`}
                    >
                      {item.title}
                    </Link>
                    <span className="mt-0.5 block font-mono text-[11px] text-muted">
                      {t("favorite.workCount", { count: item.itemCount })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title={t("catalog.noOther")}
                variant="plain"
                className="leading-6"
              />
            )}
            {catalog.ownerProfileShowsCatalogs ? (
              <Link
                className="mt-3 block border-t border-border pt-3 text-xs font-semibold text-primary hover:underline"
                to={`/users/${catalog.ownerUserId}/catalogs`}
              >
                {t("catalog.allByOwner")}
              </Link>
            ) : null}
          </SidebarPanel>

          <SidebarPanel title={t("catalog.related")}>
            <nav aria-label={t("catalog.relatedNav")}>
              <ul className="m-0 list-none divide-y divide-border p-0 text-sm">
                <li>
                  <Link
                    className="block py-2 first:pt-0 hover:text-primary"
                    to="/catalogs"
                  >
                    {t("catalog.allCollections")}
                  </Link>
                </li>
                <li>
                  <Link
                    className="block py-2 hover:text-primary"
                    to={`/users/${catalog.ownerUserId}`}
                  >
                    {t("catalog.ownerProfile")}
                  </Link>
                </li>
                {currentUser && currentUser.id !== catalog.ownerUserId ? (
                  <li>
                    <Link
                      className="block py-2 last:pb-0 hover:text-primary"
                      to="/me/catalogs"
                    >
                      {t("catalog.manageMine")}
                    </Link>
                  </li>
                ) : null}
              </ul>
            </nav>
          </SidebarPanel>
        </aside>
      </div>
    </main>
  );
}

function SidebarPanel({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <h2 className="m-0 border-b border-border bg-muted/5 px-4 py-3 text-sm font-bold">
        {title}
      </h2>
      <div className="p-4">{children}</div>
    </section>
  );
}
