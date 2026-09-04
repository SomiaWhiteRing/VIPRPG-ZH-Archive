import { buttonVariants } from "@/app/components/ui/button";
import Link from "next/link";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { AdminListControls, parseAdminPage, searchParam } from "@/app/admin/admin-list-controls";
import { CharacterCreateButton } from "@/app/admin/characters/character-create-button";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { hasPermission } from "@/lib/authz/permissions";
import { searchCharactersForAdmin } from "@/lib/server/db/taxonomy-library";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminCharactersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const adminUser = await requirePagePermission("/admin/characters", "character.read_private");
  const params = await searchParams;
  const query = searchParam(params.q);
  const sort = allowed(searchParam(params.sort), ["default", "name", "works"], "default");
  const page = parseAdminPage(params.page);
  const result = await searchCharactersForAdmin({ query, sort, page, pageSize: PAGE_SIZE });

  return (
    <main>
      <PageHeader
        compact
        title="登场角色维护"
        subtitle="维护角色名称、说明和作品关联。"
        actions={(
          <>
            {hasPermission(adminUser, "character.update") ? <CharacterCreateButton /> : null}
            <Link className={buttonVariants({ variant: "outline" })} href="/characters">查看公开列表</Link>
          </>
        )}
      />
      <AdminListControls action="/admin/characters" noun="角色" query={query} sort={sort} sortOptions={[{ value: "default", label: "最近更新" }, { value: "name", label: "名称" }, { value: "works", label: "登场作品数" }]} total={result.total} />
      {result.items.length > 0 ? <TableWrap compact label="角色列表" minWidth={900}>
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
                {character.originalName ? <span className="text-sm text-muted">{character.originalName}</span> : null}
              </td>
              <td>{formatNumber(character.workCount)}</td>
              <td>{character.updatedAt}</td>
              <td>
                <Link className={buttonVariants()} href={`/admin/characters/${character.id}`}>编辑</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap> : <EmptyState title="没有找到匹配的角色。" />}
      <PaginationLinks basePath="/admin/characters" page={page} pageSize={PAGE_SIZE} total={result.total} params={{ q: query || undefined, sort: sort === "default" ? undefined : sort }} />
    </main>
  );
}

function allowed<T extends string>(value: string, values: readonly T[], fallback: T): T { return values.includes(value as T) ? value as T : fallback; }
