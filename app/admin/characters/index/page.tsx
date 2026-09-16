import Link from "next/link";
import { PageHeader } from "@/app/components/ui/page-header";
import { buttonVariants } from "@/app/components/ui/button";
import { CHARACTER_INDEX_PERMISSIONS } from "@/lib/authz/permissions";
import { requireAnyPagePermission } from "@/lib/server/auth/authorize";
import { readCharacterIndex } from "@/lib/server/db/character-index";
import { CharacterIndexEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function CharacterIndexAdminPage({ searchParams }: { searchParams: Promise<{ character?: string; category?: string }> }) {
  const user = await requireAnyPagePermission("/admin/characters/index", ["character.admin.read", ...CHARACTER_INDEX_PERMISSIONS]);
  const params = await searchParams;
  return <main>
    <PageHeader compact title="角色分类" actions={<>
      <Link className={buttonVariants({ variant: "outline" })} href="/admin/characters">角色资料</Link>
      <Link className={buttonVariants({ variant: "outline" })} href="/characters" target="_blank">查看公开索引</Link>
    </>} />
    <CharacterIndexEditor permissionKeys={user.permissionKeys} initialData={await readCharacterIndex()} initialCharacterId={Number(params.character) || undefined} initialCategoryId={params.category} />
  </main>;
}
