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
  const externalDownload =
    work.externalLinks.find((link) => link.linkType === "download_page") ?? null;
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
      {/* 页头 */}
      <div className="mb-6">
        <BackLink href="/games" label="返回游戏库" />
        <h1 className="mt-3 text-2xl font-extrabold md:text-3xl">
          {title}
          <StatusBadge kind="publication" value={work.status} className="ml-3" />
        </h1>
        {work.chineseTitle && (
          <p className="mt-1 text-base text-muted">{work.originalTitle}</p>
        )}
      </div>

      {/* 桌面端：主内容 + 侧边栏 / 移动端：单栏 */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* 主内容区 */}
        <div className="grid gap-6">
          {/* 媒体展示 */}
          <section>
            <div className="overflow-hidden rounded-lg border border-border bg-muted/5">
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
                <div className="grid aspect-video place-items-center text-sm text-muted">
                  {engineLabel(work.engineFamily)}
                </div>
              )}
            </div>
            {work.media.filter((media) => media.blobSha256 !== primaryMedia).length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-3" aria-label="浏览图">
                {work.media
                  .filter((media) => media.blobSha256 !== primaryMedia)
                  .slice(0, 3)
                  .map((media) => (
                    <div key={media.blobSha256} className="overflow-hidden rounded border border-border">
                      <Image
                        alt={media.altText ?? title}
                        className="h-auto w-full object-cover"
                        height={160}
                        src={`/api/media/blobs/${media.blobSha256}`}
                        unoptimized
                        width={240}
                      />
                    </div>
                  ))}
              </div>
            )}
          </section>

          {/* 移动端：操作按钮提前 */}
          <section className="lg:hidden">
            <div className="rounded-lg border border-border bg-card p-4">
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
                externalDownload={externalDownload ? { url: externalDownload.url } : null}
                canPlayInBrowser
              />
            </div>
          </section>

          {/* 简介与标签 */}
          <section className="rounded-lg border border-border bg-card p-5">
            {work.engineFamily === "rpg_maker_2003_maniac" && (
              <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                ⚠️ 该游戏使用了 Maniac，可能无法用 EasyRPG 正常游玩。
              </div>
            )}
            {work.description && (
              <p className="mb-4 leading-relaxed">{publicCopy(work.description)}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {work.tags.map((tag) => (
                <Link
                  key={tag.id}
                  href={`/games?tag=${tag.id}`}
                  className="rounded border border-primary/30 px-2 py-1 text-sm text-primary transition-colors hover:border-primary/50 hover:bg-primary/5"
                >
                  {tag.name}
                </Link>
              ))}
            </div>
            {work.characters.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="mb-2 text-sm font-semibold text-muted">登场角色</h3>
                <div className="flex flex-wrap gap-2">
                  {work.characters.map((character) => (
                    <Link
                      key={character.id}
                      href={`/games?character=${character.id}`}
                      className="rounded border border-border px-2 py-1 text-sm transition-colors hover:border-primary/40 hover:bg-muted/10"
                    >
                      {character.primaryName}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {work.creators.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="mb-2 text-sm font-semibold text-muted">制作人员</h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {work.creators.map((creator) => (
                    <Link
                      key={`${creator.id}-${creator.roleKey}`}
                      href={`/creators/${creator.id}`}
                      className="text-primary hover:underline"
                    >
                      {creator.name}
                      <span className="ml-1 text-muted">
                        {creator.roleLabel || creatorRoleLabel(creator.roleKey)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* 原版与译版 */}
          {translations.length > 0 && (
            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="mb-3 text-lg font-semibold">原版与译版</h2>
              <ul className="grid gap-3">
                {translations.map((item) => (
                  <li
                    key={`${item.role}-${item.workId}`}
                    className="flex items-baseline justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0"
                  >
                    <Link
                      href={`/games/${item.workId}`}
                      className="text-primary hover:underline"
                    >
                      {item.title}
                    </Link>
                    <span className="text-sm text-muted">
                      {item.role === "original" ? "原版" : "译版"} · {languageLabel(item.language)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 系列作与关联 */}
          {work.relations.length > 0 && (
            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="mb-3 text-lg font-semibold">系列作与关联</h2>
              <ul className="grid gap-3">
                {work.relations.map((relation) => (
                  <li key={relation.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link
                        href={`/games/${relation.workId}`}
                        className="text-primary hover:underline"
                      >
                        {relation.title}
                      </Link>
                      <span className="text-sm text-muted">
                        {relationLabel(relation.relationType)}
                      </span>
                    </div>
                    {relation.notes && (
                      <p className="mt-1 text-sm text-muted">{relation.notes}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 关系编辑器 */}
          {(relationCapabilities.canAddRelations || relationCapabilities.canRemoveRelations) && (
            <section className="rounded-lg border border-border bg-card p-5">
              <RelationEditor
                {...relationCapabilities}
                currentUserId={currentUser?.id ?? null}
                language={work.language}
                parallelTranslations={work.parallelTranslations}
                relations={work.relations}
                translations={work.translations}
                workId={work.id}
              />
            </section>
          )}

          {/* 互动区 */}
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-4 text-lg font-semibold">社区互动</h2>
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
          </section>

          {/* 详细资料（折叠） */}
          <details className="rounded-lg border border-border bg-card">
            <summary className="cursor-pointer p-5 font-semibold hover:bg-muted/5">
              详细资料
            </summary>
            <div className="border-t border-border p-5">
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-muted">名称</h3>
                  <dl className="grid gap-2 text-sm">
                    <div>
                      <dt className="inline text-muted">原名：</dt>
                      <dd className="inline">{work.originalTitle}</dd>
                    </div>
                    {work.chineseTitle && (
                      <div>
                        <dt className="inline text-muted">中文名：</dt>
                        <dd className="inline">{work.chineseTitle}</dd>
                      </div>
                    )}
                    {work.aliases.length > 0 && (
                      <div>
                        <dt className="inline text-muted">别名：</dt>
                        <dd className="inline">{work.aliases.join(" / ")}</dd>
                      </div>
                    )}
                  </dl>
                </div>
                {work.externalLinks.filter((link) => link.linkType !== "download_page").length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-muted">外部链接</h3>
                    <ul className="grid gap-2 text-sm">
                      {work.externalLinks
                        .filter((link) => link.linkType !== "download_page")
                        .map((link) => (
                          <li key={link.id}>
                            <a
                              href={link.url}
                              rel="noreferrer"
                              target="_blank"
                              className="text-primary hover:underline"
                            >
                              {link.label}
                            </a>
                            <span className="ml-2 text-muted">({link.linkType})</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </details>
        </div>

        {/* 侧边栏（仅桌面端） */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 grid gap-4">
            {/* 操作按钮 */}
            <div className="rounded-lg border border-border bg-card p-4">
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
                externalDownload={externalDownload ? { url: externalDownload.url } : null}
                canPlayInBrowser
              />
            </div>

            {/* 元信息 */}
            <div className="rounded-lg border border-border bg-card p-4">
              <dl className="grid gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <dt className="text-muted">引擎</dt>
                  <dd className="ml-auto font-medium">{engineLabel(work.engineFamily)}</dd>
                </div>
                <div className="flex items-center gap-2 border-t border-border pt-3">
                  <dt className="text-muted">语言</dt>
                  <dd className="ml-auto font-medium">{languageLabel(work.language)}</dd>
                </div>
                <div className="flex items-center gap-2 border-t border-border pt-3">
                  <dt className="text-muted">类型</dt>
                  <dd className="ml-auto">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        work.isOriginal
                          ? "border border-accent/40 text-accent"
                          : "border border-border text-muted"
                      }`}
                    >
                      {work.isOriginal ? "本站原创" : "社区收录"}
                    </span>
                  </dd>
                </div>
                {work.distribution === "archive" && (
                  <div className="flex items-center gap-2 border-t border-border pt-3">
                    <dt className="text-muted">大小</dt>
                    <dd className="ml-auto font-medium">{formatBytes(work.totalSizeBytes)}</dd>
                  </div>
                )}
                <div className="flex items-center gap-2 border-t border-border pt-3">
                  <dt className="text-muted">发布</dt>
                  <dd className="ml-auto font-medium">
                    {formatDateish(work.originalReleaseDate, work.originalReleasePrecision)}
                  </dd>
                </div>
              </dl>
            </div>

            {/* 当前快照 */}
            {current && (
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold">当前快照</h3>
                <p className="text-xs text-muted">
                  归档 #{current.id} · {languageLabel(current.language)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {formatNumber(current.totalFiles)} 文件 · {formatBytes(current.totalSizeBytes)}
                </p>
                {current.uploaderName && (
                  <p className="mt-1 text-xs text-muted">上传者：{current.uploaderName}</p>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
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
