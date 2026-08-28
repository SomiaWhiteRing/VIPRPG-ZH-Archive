import { buttonVariants } from "@/app/components/ui/button";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { ChipList } from "@/app/components/ui/chip-list";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import { getGameWorkDetail } from "@/lib/server/db/game-library";
import { formatBytes, formatNumber } from "@/lib/format";
import {
  creatorRoleLabel,
  engineLabel,
  languageLabel,
  relationLabel,
} from "@/lib/labels";
import { publicCopy } from "@/lib/public-copy";
import { WorkActionBar } from "./work-action-bar";
import { RelationEditor } from "./relation-editor";
import { getCurrentUserFromCookies } from "@/lib/server/auth/current-user";
import { getRelationEditorCapabilities } from "@/lib/authz/permissions";
import { parsePositiveId } from "@/lib/server/http/request";
import { getWorkCommunitySummary, listPickerEmojis, listRootComments } from "@/lib/server/db/work-community";
import { listCatalogs } from "@/lib/server/db/catalogs";
import { WorkCommunityPanel } from "./work-community-panel";

export const dynamic = "force-dynamic";

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = parsePositiveId((await params).id, "work id");
  const work = await getGameWorkDetail(id);
  if (!work) notFound();
  const currentUser = await getCurrentUserFromCookies();
  const relationCapabilities = getRelationEditorCapabilities(currentUser);
  const title = work.chineseTitle || work.originalTitle;
  const current = work.archiveVersions[0] ?? null;
  const primaryMedia =
    work.media.find((media) => media.isPrimary)?.blobSha256 ??
    work.previewBlobSha256;
  const [community, comments, emojis, catalogs] = await Promise.all([
    getWorkCommunitySummary(work.id, currentUser?.id ?? null),
    listRootComments(work.id, currentUser?.id ?? null, null),
    listPickerEmojis(),
    currentUser ? listCatalogs() : Promise.resolve([]),
  ]);
  const translations = [
    ...work.translations,
    ...work.parallelTranslations.filter(
      (item) =>
        item.workId !== work.id &&
        !work.translations.some((direct) => direct.workId === item.workId),
    ),
  ];

  return (
    <main>
      <PageHeader
        actions={<BackLink href="/games" label="返回游戏库" />}
        subtitle={work.chineseTitle ? work.originalTitle : undefined}
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            {title}
            <StatusBadge kind="publication" value={work.status} />
          </span>
        }
      />
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,380px)]">
        <div className="grid gap-3">
          <div className="grid aspect-video place-items-center overflow-hidden rounded-lg border border-border bg-muted/15 text-sm text-muted">
            {primaryMedia ? (
              <Image
                alt={title}
                className="h-auto w-full object-contain"
                height={480}
                src={`/api/media/blobs/${primaryMedia}`}
                unoptimized
                width={860}
              />
            ) : (
              engineLabel(work.engineFamily)
            )}
          </div>
          {work.media.filter((media) => media.blobSha256 !== primaryMedia)
            .length > 0 ? (
            <div className="grid grid-cols-3 gap-3" aria-label="浏览图">
              {work.media
                .filter((media) => media.blobSha256 !== primaryMedia)
                .slice(0, 3)
                .map((media) => (
                  <Image
                    alt={media.altText ?? title}
                    className="h-auto w-full rounded-md border border-border object-cover"
                    height={160}
                    key={media.blobSha256}
                    src={`/api/media/blobs/${media.blobSha256}`}
                    unoptimized
                    width={240}
                  />
                ))}
            </div>
          ) : null}
        </div>
        <Pane heading="游戏概览">
          <ChipList
            items={[
              { label: engineLabel(work.engineFamily) },
              { label: languageLabel(work.language) },
              { label: work.isOriginal ? "本站原创" : "社区收录" },
            ]}
          />
          <WorkActionBar
            isAuthenticated={Boolean(currentUser)}
            workId={work.id}
            archive={
              current
                ? {
                id: current.id,
                    downloadHref: `/api/archive-versions/${current.id}/download?zip_builder=${downloadZipBuilderVersion}`,
                    totalFiles: current.totalFiles,
                    totalSizeBytes: current.totalSizeBytes,
                  }
                : null
            }
            canPlayInBrowser
          />
          {work.engineFamily === "rpg_maker_2003_maniac" ? (
            <p className="text-sm text-amber-700">
              该游戏使用了 Maniac，可能无法用 EasyRPG 正常游玩。
            </p>
          ) : null}
          {work.description ? <p>{publicCopy(work.description)}</p> : null}
          <StatList
            items={[
              {
                label: "原作发布日期",
                value: formatDateish(
                  work.originalReleaseDate,
                  work.originalReleasePrecision,
                ),
              },
              {
                label: "当前文件大小",
                value: formatBytes(work.totalSizeBytes),
              },
            ]}
          />
        </Pane>
      </section>
      <Pane heading="当前快照">
        {current ? (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div>
              <strong>归档 #{current.id}</strong>
              <ChipList
                compact
                items={[{ label: languageLabel(current.language) }]}
              />
              <p className="text-sm text-muted">
                {formatNumber(current.totalFiles)} 文件 ·{" "}
                {formatBytes(current.totalSizeBytes)}
                {current.uploaderName
                  ? ` · 上传者：${current.uploaderName}`
                  : ""}
              </p>
            </div>
            <ArchiveActions
              archiveId={current.id}
              canPlayInBrowser
            />
          </div>
        ) : (
          <p className="text-sm text-muted">当前还没有可下载快照。</p>
        )}
      </Pane>
      <Pane heading="互动">
        <WorkCommunityPanel
          currentUserId={currentUser?.id ?? null}
          emojis={emojis}
          initialComments={comments.items}
          initialNextCursor={comments.nextCursor}
          initialWishlisted={community.wishlistedByMe}
          stats={community}
          catalogs={catalogs.filter((catalog) => catalog.ownerUserId === currentUser?.id)}
          workId={work.id}
        />
      </Pane>
      <section
        className="grid gap-5 scroll-mt-24 lg:grid-cols-2"
        id="relations"
      >
        <Pane heading="原版与译版">
          {translations.length ? (
            <ul className="grid gap-3">
              {translations.map((item) => (
                <li
                  className="flex flex-wrap items-baseline justify-between gap-2"
                  key={`${item.role}-${item.workId}`}
                >
                  <Link href={`/games/${item.workId}`}>{item.title}</Link>
                  <span className="text-sm text-muted">
                    {item.role === "original" ? "原版" : "译版"} ·{" "}
                    {languageLabel(item.language)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">尚未建立翻译关联。</p>
          )}
        </Pane>
        <Pane heading="普通关联">
          {work.relations.length ? (
            <ul className="grid gap-3">
              {work.relations.map((relation) => (
                <li className="grid gap-1" key={relation.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/games/${relation.workId}`}>
                      {relation.title}
                    </Link>
                    <span className="text-sm text-muted">
                      {relationLabel(relation.relationType)}
                    </span>
                  </div>
                  {relation.notes ? (
                    <p className="text-sm text-muted">{relation.notes}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">尚未建立普通关联。</p>
          )}
        </Pane>
        <Pane>
          <RelationEditor
            {...relationCapabilities}
            currentUserId={currentUser?.id ?? null}
            language={work.language}
            parallelTranslations={work.parallelTranslations}
            relations={work.relations}
            translations={work.translations}
            workId={work.id}
          />
        </Pane>
      </section>
      <Pane heading="资料">
        <div className="grid gap-5 md:grid-cols-2">
          <section>
            <h3>名称</h3>
            <StatList
              items={[
                { label: "原名", value: work.originalTitle },
                { label: "中文名", value: work.chineseTitle ?? "未填写" },
                {
                  label: "别名",
                  value: work.aliases.length
                    ? work.aliases.join(" / ")
                    : "未填写",
                },
              ]}
            />
          </section>
          <section>
            <h3>制作人员</h3>
            {work.creators.length ? (
              <ul className="mt-3 grid gap-2">
                {work.creators.map((creator) => (
                  <li key={`${creator.id}-${creator.roleKey}`}>
                    <Link href={`/creators/${creator.id}`}>
                      {creator.name}
                    </Link>
                    <span className="text-sm text-muted">
                      {creator.roleLabel || creatorRoleLabel(creator.roleKey)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">未填写。</p>
            )}
          </section>
          <section>
            <h3>登场角色</h3>
            {work.characters.length ? (
              <ChipList
                items={work.characters.map((character) => ({
                  href: `/games?character=${character.id}`,
                  label: character.primaryName,
                }))}
              />
            ) : (
              <p className="text-sm text-muted">未填写。</p>
            )}
          </section>
          <section>
            <h3>标签</h3>
            {work.tags.length ? (
              <ChipList
                items={work.tags.map((tag) => ({
                  href: `/games?tag=${tag.id}`,
                  label: tag.name,
                }))}
              />
            ) : (
              <p className="text-sm text-muted">未填写。</p>
            )}
          </section>
          <section className="md:col-span-2">
            <h3>外部链接</h3>
            {work.externalLinks.length ? (
              <ul className="mt-3 grid gap-2">
                {work.externalLinks.map((link) => (
                  <li key={link.id}>
                    <a href={link.url} rel="noreferrer" target="_blank">
                      {link.label}
                    </a>
                    <span className="text-sm text-muted">{link.linkType}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">未填写。</p>
            )}
          </section>
        </div>
      </Pane>
    </main>
  );
}


function ArchiveActions({
  archiveId,
  canPlayInBrowser,
}: {
  archiveId: number;
  canPlayInBrowser: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        className={buttonVariants()}
        href={`/api/archive-versions/${archiveId}/download?zip_builder=${downloadZipBuilderVersion}`}
      >
        下载 ZIP
      </a>
      {canPlayInBrowser ? (
        <Link
          className={buttonVariants({ variant: "outline" })}
          href={`/play/${archiveId}`}
        >
          在线游玩
        </Link>
      ) : (
        <span className="text-sm text-muted">暂不支持在线游玩</span>
      )}
    </div>
  );
}
function formatDateish(value: string | null, precision: string): string {
  return !value || precision === "unknown" ? "日期未知" : value;
}
