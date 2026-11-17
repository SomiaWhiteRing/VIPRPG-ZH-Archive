import { useMessages } from "@/lib/i18n/react";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { getPublicCharacterDetail } from "@/app/.server/db/character-detail";
import { listRootComments } from "@/app/.server/db/work-community";
import { throwNotFound } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import type { AppRuntime } from "@/app/.server/runtime";
import { CharacterContentTabs } from "@/app/characters/[id]/character-content-tabs";
import { CharacterMaterials } from "@/app/characters/[id]/character-materials";
import { CharacterWorkList } from "@/app/characters/character-work-list";
import { CommentPanel } from "@/app/components/comments/comment-panel";
import { BackLink } from "@/app/components/ui/back-link";
import { buttonVariants } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { DetailPageShell } from "@/app/components/ui/detail-page-layout";
import { EmptyState } from "@/app/components/ui/empty-state";
import { InfoRow } from "@/app/components/ui/info-row";
import {
  CHARACTER_EDIT_PERMISSIONS,
  hasPermission,
} from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { ExternalLink, Pencil } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";

const readCharacter = async (runtime: AppRuntime, rawId: string) => {
  const id = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id <= 0)
    throwNotFound();
  const character = await getPublicCharacterDetail(runtime, id);
  if (!character) throwNotFound();
  return character;
};

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const character = await readCharacter(runtime, (await params).id);
  const user = await getCurrentUser(runtime);
  const canEdit = CHARACTER_EDIT_PERMISSIONS.some((permission) =>
    hasPermission(user, permission),
  );
  const comments = await listRootComments(
    runtime,
    { kind: "character", id: character.id },
    user?.id ?? null,
    null,
  );

  const pageMetadata = { title: character.primaryName };
  return {
    locale: runtime.uiLocale,
    character,
    user: pickPageFields(user, ["id"]),
    canEdit,
    comments,
    pageMetadata,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors(loaderData?.pageMetadata, error, locale);
};

export default function CharacterDetailPage() {
  const t = useMessages();
  const { character, user, canEdit, comments } = useLoaderData<typeof loader>();
  return (
    <DetailPageShell>
      <header className="pb-4 pt-4">
        <BackLink href="/characters" label={t("character.index")} variant="text" />
        <div className="mt-2 flex items-start gap-2">
            <h1 className="min-w-0 wrap-anywhere font-serif text-3xl font-bold leading-tight max-[560px]:text-2xl">
            {character.primaryName}
          </h1>
          {canEdit ? (
            <Link
              aria-label={t("character.editNamed", { name: character.primaryName })}
              className={buttonVariants({ variant: "ghost", size: "icon" })}
              to={`/admin/characters/${character.id}`}
              prefetch="none"
              title={t("character.edit")}
            >
              <Pencil aria-hidden />
            </Link>
          ) : null}
        </div>
        <p className="mt-1.5 text-sm text-muted" lang="ja">
          {character.originalName}
        </p>
      </header>
      <CharacterContentTabs
        key={character.id}
        workCount={character.workCount}
        materialCount={character.materials.length}
        intro={character.description ? (
          <section aria-labelledby="character-intro-title" className="scroll-mt-20 py-4.5" id="sec-intro">
            <h2 className="mb-3.5 text-base font-bold" id="character-intro-title">{t("work.intro")}</h2>
            <p className="m-0 whitespace-pre-wrap leading-[1.85] wrap-anywhere">
              {character.description}
            </p>
          </section>
        ) : null}
        works={
          <section aria-labelledby="works-title" className={`scroll-mt-20 py-4.5 ${character.description ? "border-t border-border" : ""}`} id="sec-works">
            <div className="mb-3.5 flex items-baseline justify-between gap-4">
              <h2 className="m-0 text-base font-bold" id="works-title">
                {t("character.works")}
              </h2>
              {character.works.length ? (
                <Link
                  aria-label={t("character.allWorks")}
                  className="shrink-0 whitespace-nowrap text-sm font-medium text-secondary hover:underline"
                  to={`/characters/${character.id}/works`}
                >
                  {t("work.more")}
                </Link>
              ) : null}
            </div>
            {character.works.length ? (
              <CharacterWorkList works={character.works} characterName={character.primaryName} />
            ) : <EmptyState title={t("character.emptyWorks")} variant="plain" />}
          </section>
        }
        materials={
          <CharacterMaterials
            characterId={character.id}
            canCollect={!!user}
            materials={character.materials}
            name={character.primaryName}
          />
        }
        sidebar={
          <Card className="rounded-lg border border-border bg-card p-4.5 text-card-foreground shadow-none max-[980px]:w-full">
            <CharacterPortrait
              className="mx-auto size-48 rounded-md"
              displayName={character.primaryName}
              portrait={character.portrait}
              size={192}
            />
            <h2 className="mt-4 text-center font-serif text-xl font-bold">
              {character.primaryName}
            </h2>
            <dl className="mt-4">
              <InfoRow label={t("character.nameJa")}>
                <span lang="ja">{character.originalName}</span>
              </InfoRow>
              {(["zh", "ja"] as const).map((language) => {
                const names = character.aliases
                  .filter((alias) => alias.language === language)
                  .map((alias) => alias.name);
                return names.length ? (
                  <InfoRow
                    key={language}
                    label={language === "zh" ? t("character.aliasesZh") : t("character.aliasesJa")}
                  >
                    <span lang={language}>{names.join("、")}</span>
                  </InfoRow>
                ) : null;
              })}
              <InfoRow label={t("character.works")}>
                {t("favorite.workCount", { count: character.workCount })}
              </InfoRow>
              <InfoRow label={t("character.materials")}>
                {t("character.materialCount", { count: character.materials.length })}
              </InfoRow>
              {character.categories.length ? (
                <InfoRow label={t("character.categories")}>
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {character.categories.map((category) => (
                      <li key={category.id}>{category.path}</li>
                    ))}
                  </ul>
                </InfoRow>
              ) : null}
            </dl>
            {canEdit || character.sourceUrls.length ? (
              <ul className="m-0 mt-3 grid list-none gap-1 p-0">
                {canEdit ? (
                  <li>
                    <Link
                      className="inline-flex min-h-8 items-center text-sm font-medium text-primary hover:underline"
                      to={`/history/character/${character.id}`}
                      prefetch="none"
                    >
                      {t("work.sidebar.history")}
                    </Link>
                  </li>
                ) : null}
                {character.sourceUrls.map((url, index) => (
                  <li key={url}>
                    <a
                      className="inline-flex min-h-8 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      href={url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {t("character.sources")}
                      {character.sourceUrls.length > 1 ? ` ${index + 1}` : ""}
                      <ExternalLink aria-hidden size={14} />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        }
      >
        <section
          aria-labelledby="comments-title"
          className="scroll-mt-20 border-t border-border py-4.5"
          id="sec-comments"
        >
          <div className="mb-3.5 flex items-baseline justify-between gap-4">
            <h2 className="m-0 text-base font-bold" id="comments-title">
              {t("work.stats.commentsShort")}
            </h2>
          </div>
          <CommentPanel
            currentUserId={user?.id ?? null}
            initialComments={comments.items}
            initialTotal={comments.total}
            placeholder={t("character.commentPlaceholder")}
            target={{ kind: "character", id: character.id }}
          />
        </section>
      </CharacterContentTabs>
    </DetailPageShell>
  );
}
