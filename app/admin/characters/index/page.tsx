import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { readCharacterIndex } from "@/app/.server/db/character-index";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { buttonVariants } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { CHARACTER_INDEX_PERMISSIONS } from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
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
    locale: runtime.uiLocale,
    renderData0,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.characterIndex.title"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};

export default function CharacterIndexAdminPage() {
  const t = useMessages();
  const { user, params, renderData0 } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title={t("admin.characterIndex.title")}
        actions={
          <>
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/characters"
            >
              {t("admin.characterIndex.profiles")}
            </Link>
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/characters"
              target="_blank"
            >
              {t("admin.characterIndex.publicIndex")}
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
