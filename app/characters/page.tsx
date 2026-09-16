import { PageContainer } from "@/app/components/ui/page-container";
import type { Metadata } from "next";
import Link from "next/link";
import { FolderPen } from "lucide-react";
import { buttonVariants } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { CharacterIndexBrowser } from "@/app/characters/character-index-browser";
import { readCharacterIndex } from "@/lib/server/db/character-index";
import { formatNumber } from "@/lib/format";
import { stringParam } from "@/lib/params";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { CHARACTER_EDIT_PERMISSIONS, CHARACTER_INDEX_PERMISSIONS, hasPermission } from "@/lib/authz/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "角色索引 · VIPRPG.org",
  description: "按阵营与角色群浏览 VIPRPG 角色，查找中日文名称、别名、Wiki 资料与登场作品。",
};

type CharactersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CharactersPage({ searchParams }: CharactersPageProps) {
  const params = await searchParams;
  const query = stringParam(params.q).trim();
  const [data, currentUser] = await Promise.all([readCharacterIndex(), getCurrentUserFromCookies()]);
  const canEdit = CHARACTER_EDIT_PERMISSIONS.some((permission) => hasPermission(currentUser, permission));
  const canEditIndex = CHARACTER_INDEX_PERMISSIONS.some((permission) => hasPermission(currentUser, permission));

  return (
    <PageContainer>
      <PageHeader
        compact
        title="角色索引"
        actions={<>
          <span className="text-sm text-muted">收录 <strong className="tabular-nums text-foreground">{formatNumber(data.characters.length)}</strong> 位角色</span>
          {canEditIndex ? <Link aria-label="编辑角色索引" className={buttonVariants({ variant: "ghost", size: "icon" })} href="/admin/characters/index" prefetch={false} title="编辑角色索引"><FolderPen aria-hidden /></Link> : null}
        </>}
      />

      <div className="mt-5">
        <CharacterIndexBrowser canEdit={canEdit} canEditIndex={canEditIndex} data={data} initialQuery={query} key={query} />
      </div>
    </PageContainer>
  );
}
