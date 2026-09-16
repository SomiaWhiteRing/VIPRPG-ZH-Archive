import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { searchCharactersForAdmin } from "@/app/.server/db/taxonomy-library";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import {
  AdminListControls,
  parseAdminPage,
  searchParam,
} from "@/app/admin/admin-list-controls";
import { CharacterCreateButton } from "@/app/admin/characters/character-create-button";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import {
  CHARACTER_ADMIN_PERMISSIONS,
  CHARACTER_DETAIL_PERMISSIONS,
  CHARACTER_INDEX_PERMISSIONS,
  hasPermission,
} from "@/lib/authz/permissions";
import { formatNumber } from "@/lib/format";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

const PAGE_SIZE = 50;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const adminUser = await requireAnyPagePermission(
    runtime,
    "/admin/characters",
    CHARACTER_ADMIN_PERMISSIONS,
  );
  const params = await searchParams;
  const query = searchParam(params.q);
  const sort = allowed(
    searchParam(params.sort),
    ["default", "name", "works"],
    "default",
  );
  const page = parseAdminPage(params.page);
  const result = await searchCharactersForAdmin(runtime, {
    query,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  return {
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    query,
    sort,
    page,
    result,
  };
}

export default function AdminCharactersPage() {
  const { adminUser, query, sort, page, result } =
    useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title="登场角色维护"
        subtitle="维护角色名称、说明和作品关联。"
        actions={
          <>
            {hasPermission(adminUser, "character.admin.read") ||
            CHARACTER_INDEX_PERMISSIONS.some((key) =>
              hasPermission(adminUser, key),
            ) ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                to="/admin/characters/index"
              >
                角色分类
              </Link>
            ) : null}
            {hasPermission(adminUser, "character.create") ? (
              <CharacterCreateButton />
            ) : null}
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/characters"
            >
              查看公开列表
            </Link>
          </>
        }
      />
      <AdminListControls
        action="/admin/characters"
        noun="角色"
        query={query}
        sort={sort}
        sortOptions={[
          { value: "default", label: "最近更新" },
          { value: "name", label: "名称" },
          { value: "works", label: "登场作品数" },
        ]}
        total={result.total}
      />
      {result.items.length > 0 ? (
        <TableWrap compact label="角色列表" minWidth={900}>
          <thead>
            <tr>
              <th>角色</th>
              <th>登场作品</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((character) => (
              <tr key={character.id}>
                <td>
                  <strong>{character.primaryName}</strong>
                  {character.originalName ? (
                    <span className="text-sm text-muted">
                      {character.originalName}
                    </span>
                  ) : null}
                </td>
                <td>{formatNumber(character.workCount)}</td>
                <td>{character.updatedAt}</td>
                <td>
                  {CHARACTER_DETAIL_PERMISSIONS.some((key) =>
                    hasPermission(adminUser, key),
                  ) ? (
                    <Link
                      className={buttonVariants()}
                      to={`/admin/characters/${character.id}`}
                    >
                      查看与维护
                    </Link>
                  ) : (
                    <span className="text-sm text-muted">只读</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <EmptyState title="没有找到匹配的角色。" />
      )}
      <PaginationLinks
        basePath="/admin/characters"
        page={page}
        pageSize={PAGE_SIZE}
        total={result.total}
        params={{
          q: query || undefined,
          sort: sort === "default" ? undefined : sort,
        }}
      />
    </main>
  );
}

function allowed<T extends string>(
  value: string,
  values: readonly T[],
  fallback: T,
): T {
  return values.includes(value as T) ? (value as T) : fallback;
}
