import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CatalogItemsSection } from "@/app/catalogs/catalog-items-section";
import { BackLink } from "@/app/components/ui/back-link";
import { hasPermission } from "@/lib/authz/permissions";
import { formatDate, formatNumber } from "@/lib/format";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import {
  getCatalogById,
  searchCatalogsForOwner,
} from "@/lib/server/db/catalogs";
import { parsePositiveId } from "@/lib/server/http/request";
import { CatalogSummaryEditor } from "../catalog-manager";

export const dynamic = "force-dynamic";

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = parsePositiveId((await params).id, "catalog id");
  const [catalog, currentUser] = await Promise.all([
    getCatalogById(id),
    getCurrentUserFromCookies(),
  ]);
  if (!catalog) notFound();

  const ownerCatalogs = await searchCatalogsForOwner({
    userId: catalog.ownerUserId,
    pageSize: 6,
  });
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
  const firstItem = catalog.items[0] ?? null;

  return (
    <main className="mx-auto w-[min(1280px,calc(100vw-2rem))] py-5 sm:py-8">
      <BackLink href="/catalogs" label="返回目录" />
      <div className="mt-5 flex flex-col gap-8 min-[981px]:flex-row">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-[clamp(26px,4vw,36px)] font-bold leading-tight">
            {catalog.title}
          </h1>
          <section
            aria-label="目录摘要"
            className="mt-4 rounded-lg border border-border bg-muted/5 p-4 sm:p-5"
          >
            <div className="flex flex-col gap-4 sm:flex-row">
              {firstItem ? (
                <Link
                  aria-label={`查看目录首项：${firstItem.title}`}
                  className="relative block aspect-4/3 w-full shrink-0 overflow-hidden rounded-md border border-border bg-card sm:w-52"
                  href={`/games/${firstItem.workId}`}
                >
                  {catalog.coverBlobSha256 ? (
                    <Image
                      alt=""
                      className="h-full w-full object-cover"
                      height={156}
                      src={`/api/media/blobs/${catalog.coverBlobSha256}`}
                      unoptimized
                      width={208}
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center font-mono text-xs text-muted">
                      暂无封面
                    </span>
                  )}
                </Link>
              ) : (
                <div className="flex aspect-4/3 w-full shrink-0 items-center justify-center rounded-md border border-border bg-card font-mono text-xs text-muted sm:w-52">
                  暂无封面
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="m-0 whitespace-pre-wrap text-sm leading-[1.75]">
                  {catalog.description || "这个目录还没有填写说明。"}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-xs text-muted">
              <span>
                创建者{" "}
                <Link
                  className="font-semibold text-primary hover:underline"
                  href={`/users/${catalog.ownerUserId}`}
                >
                  {catalog.ownerName}
                </Link>
              </span>
              <span>
                创建于{" "}
                <time className="font-mono" dateTime={catalog.createdAt}>
                  {formatDate(catalog.createdAt)}
                </time>
              </span>
              <span>
                更新于{" "}
                <time className="font-mono" dateTime={catalog.updatedAt}>
                  {formatDate(catalog.updatedAt)}
                </time>
              </span>
              <span className="font-mono">
                {formatNumber(catalog.itemCount)} 个游戏
              </span>
              {canEditSummary || canDelete ? (
                <div className="ml-auto">
                  <CatalogSummaryEditor
                    canDelete={canDelete}
                    canEdit={canEditSummary}
                    catalog={catalog}
                  />
                </div>
              ) : null}
            </div>
          </section>

          <CatalogItemsSection
            canEdit={canEditItems}
            catalogId={catalog.id}
            items={catalog.items}
          />
        </div>

        <aside
          aria-label="目录侧栏"
          className="w-full shrink-0 space-y-5 min-[981px]:sticky min-[981px]:top-20 min-[981px]:w-72 min-[981px]:self-start"
        >
          <SidebarPanel title="目录概览">
            <div className="flex items-end gap-2">
              <strong className="font-display text-3xl leading-none">
                {formatNumber(catalog.itemCount)}
              </strong>
              <span className="text-sm text-muted">个游戏</span>
            </div>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 border-t border-border pt-3 text-xs">
              <dt className="text-muted">创建者</dt>
              <dd className="m-0 min-w-0">
                <Link
                  className="font-semibold text-primary hover:underline"
                  href={`/users/${catalog.ownerUserId}`}
                >
                  {catalog.ownerName}
                </Link>
              </dd>
              <dt className="text-muted">创建时间</dt>
              <dd className="m-0 font-mono">
                <time dateTime={catalog.createdAt}>
                  {formatDate(catalog.createdAt)}
                </time>
              </dd>
              <dt className="text-muted">最近更新</dt>
              <dd className="m-0 font-mono">
                <time dateTime={catalog.updatedAt}>
                  {formatDate(catalog.updatedAt)}
                </time>
              </dd>
            </dl>
          </SidebarPanel>

          <SidebarPanel title="作者的其他目录">
            {otherCatalogs.length ? (
              <ul className="m-0 list-none divide-y divide-border p-0">
                {otherCatalogs.map((item) => (
                  <li className="py-2.5 first:pt-0 last:pb-0" key={item.id}>
                    <Link
                      className="block text-sm font-semibold leading-5 hover:text-primary hover:underline"
                      href={`/catalogs/${item.id}`}
                    >
                      {item.title}
                    </Link>
                    <span className="mt-0.5 block font-mono text-[11px] text-muted">
                      {formatNumber(item.itemCount)} 个游戏
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-sm leading-6 text-muted">
                这位用户还没有其他公开目录。
              </p>
            )}
            <Link
              className="mt-3 block border-t border-border pt-3 text-xs font-semibold text-primary hover:underline"
              href={`/users/${catalog.ownerUserId}/catalogs`}
            >
              查看作者的全部目录
            </Link>
          </SidebarPanel>

          <SidebarPanel title="相关页面">
            <nav aria-label="目录相关页面">
              <ul className="m-0 list-none divide-y divide-border p-0 text-sm">
                <li>
                  <Link className="block py-2 first:pt-0 hover:text-primary" href="/catalogs">
                    浏览全部目录
                  </Link>
                </li>
                <li>
                  <Link
                    className="block py-2 hover:text-primary"
                    href={`/users/${catalog.ownerUserId}`}
                  >
                    查看作者主页
                  </Link>
                </li>
                {currentUser && currentUser.id !== catalog.ownerUserId ? (
                  <li>
                    <Link className="block py-2 last:pb-0 hover:text-primary" href="/me/catalogs">
                      管理我的目录
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
