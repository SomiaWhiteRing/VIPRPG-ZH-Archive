import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { listCatalogs } from "@/lib/server/db/catalogs";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { hasPermission } from "@/lib/authz/permissions";
import { CatalogCreateForm } from "./catalog-manager";

export const dynamic = "force-dynamic";
export default async function CatalogsPage() {
  const [catalogs, currentUser] = await Promise.all([
    listCatalogs(),
    getCurrentUserFromCookies(),
  ]);
  return (
    <main>
      <PageHeader title="目录" subtitle="玩家创建的游戏整理与阅读顺序。" />
      {currentUser &&
      (hasPermission(currentUser, "catalog.create") ||
        hasPermission(currentUser, "catalog.manage_any")) ? (
        <div className="mb-6">
          <CatalogCreateForm />
        </div>
      ) : null}
      {catalogs.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {catalogs.map((catalog) => (
            <li
              className="rounded-lg border border-border bg-card p-5"
              key={catalog.id}
            >
              <Link
                className="text-lg font-bold"
                href={`/catalogs/${catalog.id}`}
              >
                {catalog.title}
              </Link>
              <p className="text-sm text-muted">
                {catalog.description || "未填写说明。"}
              </p>
              <span className="text-sm text-muted">
                {catalog.itemCount} 个游戏 · {catalog.ownerName}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="还没有公开目录。" />
      )}
    </main>
  );
}
