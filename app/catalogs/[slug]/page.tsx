import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { getCatalogBySlug } from "@/lib/server/db/catalogs";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { hasPermission } from "@/lib/authz/permissions";
import { CatalogItemsEditor, CatalogSummaryEditor } from "../catalog-manager";

export const dynamic = "force-dynamic";
export default async function CatalogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const rawSlug = (await params).slug;
  const slug = decodeRouteSegment(rawSlug);
  const [catalog, currentUser] = await Promise.all([
    getCatalogBySlug(slug),
    getCurrentUserFromCookies(),
  ]);
  if (!catalog) notFound();
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
  return (
    <main>
      <PageHeader
        title={catalog.title}
        subtitle={catalog.description ?? undefined}
        actions={<BackLink href="/catalogs" label="返回目录" />}
      />
      {canEditSummary || canDelete || canEditItems ? (
        <section className="mb-6 grid gap-4">
          {canEditSummary || canDelete ? (
            <CatalogSummaryEditor
              catalog={catalog}
              canEdit={canEditSummary}
              canDelete={canDelete}
            />
          ) : null}
          {canEditItems ? (
            <CatalogItemsEditor
              catalogId={catalog.id}
              items={catalog.items.map((item) => ({
                workId: item.workId,
                slug: item.slug,
                title: item.title,
                note: item.note,
              }))}
            />
          ) : null}
        </section>
      ) : null}
      <Pane heading={`游戏（${catalog.items.length}）`}>
        <ol className="grid gap-3">
          {catalog.items.map((item, index) => (
            <li className="flex items-baseline gap-3" key={item.workId}>
              <span className="w-8 text-right text-sm text-muted">
                {index + 1}
              </span>
              <Link href={`/games/${item.slug}`}>{item.title}</Link>
              {item.note ? (
                <span className="text-sm text-muted">{item.note}</span>
              ) : null}
            </li>
          ))}
        </ol>
      </Pane>
    </main>
  );
}

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
