import { RichMessage } from "@/app/components/ui/rich-message";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { readCharacterIndex } from "@/app/.server/db/character-index";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { CharacterIndexBrowser } from "@/app/characters/character-index-browser";
import { buttonVariants } from "@/app/components/ui/button";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import {
  CHARACTER_EDIT_PERMISSIONS,
  CHARACTER_INDEX_PERMISSIONS,
  hasPermission,
} from "@/lib/authz/permissions";
import { stringParam } from "@/lib/params";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { FolderPen } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const params = await searchParams;
  const query = stringParam(params.q).trim();
  const [data, currentUser] = await Promise.all([
    readCharacterIndex(runtime),
    getCurrentUser(runtime),
  ]);
  const canEdit = CHARACTER_EDIT_PERMISSIONS.some((permission) =>
    hasPermission(currentUser, permission),
  );
  const canEditIndex = CHARACTER_INDEX_PERMISSIONS.some((permission) =>
    hasPermission(currentUser, permission),
  );

  return { locale: runtime.uiLocale, query, data, canEdit, canEditIndex };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "character.index"), description: translate(locale, "character.description") }, error, locale);
};

export default function CharactersPage() {
  const t = useMessages();
  const { query, data, canEdit, canEditIndex } = useLoaderData<typeof loader>();
  return (
    <PageContainer>
      <PageHeader
        compact
        title={t("character.index")}
        actions={
          <>
            <span className="text-sm text-muted">
              <RichMessage id="character.count" values={{ count: data.characters.length }} components={{ emphasis: children => <strong key="count" className="tabular-nums text-foreground">{children}</strong> }} />
            </span>
            {canEditIndex ? (
              <Link
                aria-label={t("character.editIndex")}
                className={buttonVariants({ variant: "ghost", size: "icon" })}
                to="/admin/characters/index"
                prefetch="none"
                title={t("character.editIndex")}
              >
                <FolderPen aria-hidden />
              </Link>
            ) : null}
          </>
        }
      />

      <div className="mt-5">
        <CharacterIndexBrowser
          canEdit={canEdit}
          canEditIndex={canEditIndex}
          data={data}
          initialQuery={query}
          key={query}
        />
      </div>
    </PageContainer>
  );
}
