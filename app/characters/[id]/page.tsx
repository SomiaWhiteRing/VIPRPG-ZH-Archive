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
import { CommentPanel } from "@/app/components/comments/comment-panel";
import { Badge } from "@/app/components/ui/badge";
import { buttonVariants } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { CharacterPortrait } from "@/app/components/ui/character-portrait";
import { DetailPageShell } from "@/app/components/ui/detail-page-layout";
import { EmptyState } from "@/app/components/ui/empty-state";
import { InfoRow } from "@/app/components/ui/info-row";
import { WorkListRow } from "@/app/components/work/work-list-row";
import {
  CHARACTER_EDIT_PERMISSIONS,
  hasPermission,
} from "@/lib/authz/permissions";
import { CHARACTER_ROLE_LABELS } from "@/lib/character-names";
import type {
  CharacterWork,
  CharacterWorkCredit,
} from "@/lib/dto/db/character-detail";
import { formatNumber } from "@/lib/format";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

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
    character,
    user: pickPageFields(user, ["id"]),
    canEdit,
    comments,
    pageMetadata,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(loaderData?.pageMetadata, error);

export default function CharacterDetailPage() {
  const { character, user, canEdit, comments } = useLoaderData<typeof loader>();
  return (
    <DetailPageShell>
      <header className="pb-4 pt-4">
        <Link
          className="inline-flex min-h-8 items-center gap-1.5 text-sm text-muted hover:text-primary"
          to="/characters"
        >
          <ArrowLeft aria-hidden size={15} />
          角色索引
        </Link>
        <div className="mt-2 flex items-start gap-2">
          <h1 className="min-w-0 break-words font-serif text-3xl font-bold leading-tight max-[560px]:text-2xl">
            {character.primaryName}
          </h1>
          {canEdit ? (
            <Link
              aria-label={`编辑 ${character.primaryName}`}
              className={buttonVariants({ variant: "ghost", size: "icon" })}
              to={`/admin/characters/${character.id}`}
              prefetch="none"
              title="编辑角色"
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
        workCount={character.works.length}
        materialCount={character.materials.length}
        works={<CharacterWorks works={character.works} />}
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
              <InfoRow label="日文名">
                <span lang="ja">{character.originalName}</span>
              </InfoRow>
              {(["zh", "ja"] as const).map((language) => {
                const names = character.aliases
                  .filter((alias) => alias.language === language)
                  .map((alias) => alias.name);
                return names.length ? (
                  <InfoRow
                    key={language}
                    label={language === "zh" ? "中文别名" : "日文别名"}
                  >
                    <span lang={language}>{names.join("、")}</span>
                  </InfoRow>
                ) : null;
              })}
              <InfoRow label="登场作品">
                {formatNumber(character.works.length)} 部
              </InfoRow>
              <InfoRow label="素材">
                {formatNumber(character.materials.length)} 张
              </InfoRow>
              {character.categories.length ? (
                <InfoRow label="所属分类">
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {character.categories.map((category) => (
                      <li key={category.id}>{category.path}</li>
                    ))}
                  </ul>
                </InfoRow>
              ) : null}
            </dl>
            {character.sourceUrls.length ? (
              <ul className="m-0 mt-3 grid list-none gap-1 p-0">
                {character.sourceUrls.map((url, index) => (
                  <li key={url}>
                    <a
                      className="inline-flex min-h-8 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      href={url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      来源资料
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
              评论
            </h2>
            <span className="font-mono text-xs text-muted">按发帖时间排序</span>
          </div>
          <CommentPanel
            currentUserId={user?.id ?? null}
            initialComments={comments.items}
            initialNextCursor={comments.nextCursor}
            placeholder="聊聊这位角色的故事、登场表现或素材……"
            target={{ kind: "character", id: character.id }}
          />
        </section>
      </CharacterContentTabs>
    </DetailPageShell>
  );
}

function CharacterWorks({ works }: { works: CharacterWork[] }) {
  if (!works.length)
    return <EmptyState title="暂无登场作品。" variant="plain" />;
  return (
    <ul className="m-0 list-none divide-y divide-border p-0">
      {works.map((work) => (
        <li key={work.id}>
          <WorkListRow
            href={`/games/${work.id}`}
            title={work.title}
            originalTitle={work.originalTitle}
            coverBlobSha256={work.coverBlobSha256}
            authorName={work.authorName}
            releaseDate={work.releaseDate ?? "日期未知"}
            engineFamily={work.engineFamily}
            language={work.language}
          >
            {work.credits.map((credit) =>
              credit.spoilerLevel > 0 ? (
                <details className="mt-1.5 text-sm" key={credit.creditId}>
                  <summary className="cursor-pointer text-muted">
                    登场信息（含剧透）
                  </summary>
                  <CharacterCredit work={credit} />
                </details>
              ) : (
                <CharacterCredit key={credit.creditId} work={credit} />
              ),
            )}
          </WorkListRow>
        </li>
      ))}
    </ul>
  );
}

function CharacterCredit({ work }: { work: CharacterWorkCredit }) {
  return (
    <div className="mt-1.5 text-sm">
      <Badge variant="credit">{CHARACTER_ROLE_LABELS[work.roleKey]}</Badge>
      <span className="ml-2 text-muted">{work.displayName}</span>
      {work.notes ? (
        <p className="m-0 mt-1 text-muted wrap-anywhere">{work.notes}</p>
      ) : null}
    </div>
  );
}
