import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { readCharacterIndex } from "@/app/.server/db/character-index";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { buttonVariants } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { CHARACTER_INDEX_PERMISSIONS } from "@/lib/authz/permissions";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { CharacterIndexEditor } from "./editor";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const user = await requireAnyPagePermission(
    runtime,
    "/admin/characters/index",
    ["character.admin.read", ...CHARACTER_INDEX_PERMISSIONS],
  );
  const params = await searchParams;
  const renderData0 = await readCharacterIndex(runtime);

  return {
    user: pickPageFields(user, ["permissionKeys"]),
    params,
    renderData0,
  };
}

export default function CharacterIndexAdminPage() {
  const { user, params, renderData0 } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title="角色分类"
        actions={
          <>
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/characters"
            >
              角色资料
            </Link>
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/characters"
              target="_blank"
            >
              查看公开索引
            </Link>
          </>
        }
      />
      <CharacterIndexEditor
        permissionKeys={user.permissionKeys}
        initialData={renderData0}
        initialCharacterId={Number(params.character) || undefined}
        initialCategoryId={
          typeof params.category === "string" ? params.category : undefined
        }
      />
    </main>
  );
}
