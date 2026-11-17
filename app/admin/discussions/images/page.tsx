import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getD1 } from "@/app/.server/db/d1";
import { forumImageCleanupSql } from "@/app/.server/forum/image-storage";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { PageHeader } from "@/app/components/ui/page-header";
import { BackLink } from "@/app/components/ui/back-link";
import { formatDate } from "@/lib/format";
import { forumPage } from "@/lib/forum";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { ImageCleanupButton } from "./cleanup-button";
import { RedirectForm } from "@/app/components/ui/redirect-form";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  await requirePagePermission(
    runtime,
    "/admin/discussions/images",
    "forum.content.moderate_any",
  );
  const page = forumPage((await searchParams).page);
  const rows = await getD1(runtime)
    .prepare(
      `SELECT i.id,i.status,i.created_at,u.display_name AS author,p.topic_id,p.post_number FROM forum_images i JOIN users u ON u.id=i.user_id LEFT JOIN forum_posts p ON p.id=i.post_id WHERE i.status IN('ready','failed','cleanup','uncertain','uploading') AND ${forumImageCleanupSql} ORDER BY i.created_at DESC,i.id LIMIT 51 OFFSET ?`,
    )
    .bind((page - 1) * 50)
    .all<{
      id: string;
      status: string;
      created_at: string;
      author: string;
      topic_id: number | null;
      post_number: number | null;
    }>();

  return { page, rows, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.discussions.imageTitle"), translate(locale, "admin.characterIndex.console")], page: loaderData?.page }, error, locale);
};

export default function ForumImageCleanup() {
  const t = useMessages();
  const locale = useUiLocale();
  const { page, rows } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader compact title={t("admin.discussions.imageTitle")} actions={<BackLink href="/admin/discussions" label={t("admin.discussions.back")} />} />
      <p className="text-sm text-muted">
        {t("admin.discussions.imageRules")}
      </p>
      <ul className="admin-panel divide-y divide-border">
        {rows.results.slice(0, 50).map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0 text-sm">
              <p>
                <strong className="admin-cell-title">{row.author}</strong>
                <span className="admin-cell-meta">{formatDate(row.created_at, { locale })}</span>
              </p>
              <p className="break-all font-mono text-xs text-muted">{row.id}</p>
              {row.topic_id ? (
                <p>
                  {t("admin.discussions.imagePost", { id: row.topic_id, post: row.post_number ?? "" })}
                </p>
              ) : (
                <p>{t("admin.discussions.imageUnlinked")}</p>
              )}
            </div>
            {row.status === "uploading" || row.status === "uncertain" ? (
              <RedirectForm action="/api/admin/discussions/images" method="post" preserveLanguage>
                <Input type="hidden" name="id" value={row.id} />
                <Input type="hidden" name="op" value="reconcile" />
                <Button type="submit" variant="outline">
                  {t("admin.discussions.reconcile")}
                </Button>
              </RedirectForm>
            ) : (
              <ImageCleanupButton
                id={row.id}
                author={row.author}
                topicId={row.topic_id}
                postNumber={row.post_number}
                retry={row.status === "cleanup"}
              />
            )}
          </li>
        ))}
      </ul>
      {!rows.results.length ? <EmptyState title={t("admin.discussions.imageEmpty")} /> : null}
      <nav
        className="flex gap-4 text-sm text-primary"
        aria-label={t("admin.discussions.imagePages")}
      >
        {page > 1 ? <Link to={`/admin/discussions/images?page=${page - 1}`}>{t("pagination.previous")}</Link> : null}
        {rows.results.length > 50 ? (
          <Link to={`/admin/discussions/images?page=${page + 1}`}>{t("pagination.next")}</Link>
        ) : null}
      </nav>
    </main>
  );
}
