import { getGameWorkDetail } from "@/app/.server/db/game-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { runtimeContext } from "@/app/.server/router-context";
import { BackLink } from "@/app/components/ui/back-link";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PageHeader } from "@/app/components/ui/page-header";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { isCharacterRoleKey } from "@/lib/character-names";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const workId = parsePositiveId(args.params.id ?? "", "work id");
  const work = await getGameWorkDetail(runtime, workId);
  if (!work) throwNotFound();
  return { workId, title: work.chineseTitle || work.originalTitle, characters: work.characters, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const title = translate(locale, "work.cast");
  return pageMetaDescriptors({ title: loaderData?.title ? [loaderData.title, title] : title }, error, locale);
};

export default function WorkCharactersPage() {
  const t = useMessages();
  const { workId, title, characters } = useLoaderData<typeof loader>();
  return (
    <main className="mx-auto w-[min(1180px,calc(100vw-2rem))] py-5 sm:py-8">
      <PageHeader
        actions={<BackLink href={`/games/${workId}#sec-cast`} label={t("relation.backToWork")} />}
        subtitle={title}
        title={t("work.cast")}
      />
      {characters.length ? (
        <div aria-label={t("work.castList")} className="flex flex-wrap gap-x-2.5 gap-y-5">
                  {characters.map((character, index) => (
                    <Link
                      className="group grid basis-24 shrink-0 content-start gap-1 text-foreground"
                      to={`/characters/${character.id}`}
                      key={`${character.id}:${index}`}
                    >
                      <CharacterPortrait
                        className="w-full text-2xl transition-shadow duration-150 group-hover:shadow-[0_3px_10px_rgb(23_33_43/14%)]"
                        displayName={character.displayName}
                        portrait={character.portrait}
                        size={96}
                        toneKey={index}
                      />
                      <span className="text-sm font-semibold wrap-anywhere">
                        {character.displayName}
                      </span>
                      <span
                        className={`inline-flex justify-self-start rounded-full border border-border bg-card px-2 py-[0.05rem] font-mono text-xs text-muted ${character.roleKey === "main" ? "border-primary/40 bg-primary/10 text-secondary" : ""}`}
                      >
                        {t(`work.role.${isCharacterRoleKey(character.roleKey) ? character.roleKey : "other"}`)}
                      </span>
                    </Link>
                  ))}
        </div>
      ) : <EmptyState title={t("work.castEmpty")} />}
    </main>
  );
}
