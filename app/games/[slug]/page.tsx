import { buttonVariants } from "@/app/components/ui/button";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { ChipList } from "@/app/components/ui/chip-list";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { StatList } from "@/app/components/ui/stat-list";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import { getGameWorkDetail, type GameArchiveVersionDetail } from "@/lib/server/db/game-library";
import { formatNumber, formatBytes } from "@/lib/format";
import { baseVariantLabel, creatorRoleLabel, engineLabel, releaseTypeLabel } from "@/lib/labels";
import { publicCopy } from "@/lib/public-copy";
import { WorkActionBar } from "./work-action-bar";

export const dynamic = "force-dynamic";

type GameDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function GameDetailPage({ params }: GameDetailPageProps) {
  const { slug } = await params;
  const work = await getGameWorkDetail(slug);

  if (!work) {
    notFound();
  }

  const title = work.chineseTitle || work.originalTitle;
  const primaryMedia = work.media[0]?.blobSha256 ?? work.previewBlobSha256;
  const currentArchive = pickCurrentArchive(work);

  return (
    <main>
      <PageHeader
        actions={<BackLink href="/games" label="返回作品资料库" />}
        subtitle={work.chineseTitle ? work.originalTitle : undefined}
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            {title}
            <StatusBadge kind="publication" value={work.status} />
          </span>
        }
      />

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,380px)]">
        <div className="aspect-video w-full object-cover">
          <div className="overflow-hidden rounded-lg border border-border bg-muted/15">
            {primaryMedia ? (
              <Image alt={title} height={360} src={`/api/media/blobs/${primaryMedia}`} unoptimized width={640} />
            ) : (
              <span>{engineLabel(work.engineFamily)}</span>
            )}
          </div>
          {work.media.length > 1 ? (
            <section className="grid gap-3 sm:grid-cols-3" aria-label="浏览图">
              {work.media.slice(1).map((media) => (
                <Image
                  alt={media.altText ?? title}
                  height={160}
                  key={media.blobSha256}
                  src={`/api/media/blobs/${media.blobSha256}`}
                  unoptimized
                  width={240}
                />
              ))}
            </section>
          ) : null}
        </div>
        <Pane heading="作品概览">
          <ChipList
            items={[
              { label: engineLabel(work.engineFamily) },
              ...(work.usesManiacsPatch ? [{ label: "Maniacs Patch" }] : []),
            ]}
          />
          <WorkActionBar
            archive={
              currentArchive
                ? {
                    id: currentArchive.id,
                    label: publicCopy(currentArchive.archiveLabel) ?? currentArchive.archiveLabel,
                    downloadHref: `/api/archive-versions/${currentArchive.id}/download?zip_builder=${downloadZipBuilderVersion}`,
                    totalFiles: currentArchive.totalFiles,
                    totalSizeBytes: currentArchive.totalSizeBytes,
                  }
                : null
            }
            canPlayInBrowser={!work.usesManiacsPatch}
          />
          {work.description ? <p>{publicCopy(work.description)}</p> : null}
          <StatList
            items={[
              {
                label: "原作发布日期",
                value: formatDateish(work.originalReleaseDate, work.originalReleasePrecision),
              },
              { label: "发布分支", value: formatNumber(work.releaseCount) },
              {
                label: "文件版本",
                value: formatNumber(work.archiveVersionCount),
              },
              {
                label: "当前文件大小",
                value: formatBytes(work.totalSizeBytes),
              },
            ]}
          />
        </Pane>
      </section>

      <section className="grid gap-3" aria-label="发布版本">
        <SectionHeading title="发布版本与下载" />
        {work.releases.map((release) => (
          <Pane
            compact
            heading={release.label}
            headingAction={
              release.sourceUrl ? (
                <a
                  className={buttonVariants({ variant: "outline" })}
                  href={release.sourceUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  来源
                </a>
              ) : null
            }
            headingLevel={3}
            key={release.id}
          >
            <p className="text-sm text-muted">
              {releaseTypeLabel(release.type)} / {baseVariantLabel(release.baseVariant)}
              {" / "}
              {formatDateish(release.releaseDate, release.releaseDatePrecision)}
            </p>
            {release.rightsNotes ? <p>{release.rightsNotes}</p> : null}
            {release.externalLinks.length > 0 ? (
              <ChipList
                items={release.externalLinks.map((link) => ({
                  external: true,
                  href: link.url,
                  label: link.label,
                }))}
              />
            ) : null}
            {release.staff.length > 0 || release.tags.length > 0 ? (
              <ChipList
                items={[
                  ...release.staff.map((staff) => ({
                    href: `/creators/${staff.slug}`,
                    label: `${staff.roleLabel || creatorRoleLabel(staff.roleKey)}：${staff.name}`,
                  })),
                  ...release.tags.map((tag) => ({
                    href: `/games?tag=${encodeURIComponent(tag.slug)}`,
                    label: tag.name,
                  })),
                ]}
              />
            ) : null}
            <div className="w-full overflow-x-auto">
              <TableWrap compact label={`${release.label}下载版本列表`} minWidth={760}>
                <thead>
                  <tr>
                    <th>下载版本</th>
                    <th>状态</th>
                    <th>规模</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {release.archiveVersions.map((archive) => (
                    <tr key={archive.id}>
                      <td>
                        <strong>{publicCopy(archive.archiveLabel)}</strong>
                        <span className="font-mono text-sm text-primary text-sm text-muted">{archive.archiveKey}</span>
                        {archive.uploaderName ? (
                          <span className="text-sm text-muted">上传者：{archive.uploaderName}</span>
                        ) : null}
                      </td>
                      <td>
                        <ArchiveBadges archive={archive} />
                      </td>
                      <td>
                        {formatNumber(archive.totalFiles)} 文件
                        <span className="text-sm text-muted">{formatBytes(archive.totalSizeBytes)}</span>
                      </td>
                      <td>
                        <ArchiveActions archiveId={archive.id} canPlayInBrowser={!work.usesManiacsPatch} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
            <ul className="grid gap-3" aria-label={`${release.label}下载版本列表`}>
              {release.archiveVersions.map((archive) => (
                <li className="rounded-lg border border-border bg-card p-4 shadow-sm" key={archive.id}>
                  <header>
                    <strong>{publicCopy(archive.archiveLabel)}</strong>
                    <span className="font-mono text-sm text-primary text-sm text-muted">{archive.archiveKey}</span>
                  </header>
                  <ArchiveBadges archive={archive} />
                  <StatList
                    items={[
                      {
                        label: "规模",
                        value: `${formatNumber(archive.totalFiles)} 文件 / ${formatBytes(archive.totalSizeBytes)}`,
                      },
                      {
                        label: "发布日期",
                        value: formatDateish(archive.publishedAt, archive.publishedAt ? "day" : "unknown"),
                      },
                      ...(archive.uploaderName ? [{ label: "上传者", value: archive.uploaderName }] : []),
                    ]}
                  />
                  <ArchiveActions archiveId={archive.id} canPlayInBrowser={!work.usesManiacsPatch} />
                </li>
              ))}
            </ul>
          </Pane>
        ))}
      </section>

      <Pane heading="资料">
        <div className="grid gap-4">
          <section>
            <h3>名称</h3>
            <StatList
              items={[
                { label: "原名", value: work.originalTitle },
                { label: "中文名", value: work.chineseTitle ?? "未填写" },
                {
                  label: "别名",
                  value: work.aliases.length > 0 ? work.aliases.join(" / ") : "未填写",
                },
              ]}
            />
          </section>
          <section>
            <h3>制作人员</h3>
            {work.creators.length > 0 ? (
              <ul className="mt-3 grid gap-3">
                {work.creators.map((creator) => (
                  <li key={`${creator.slug}-${creator.roleKey}`}>
                    <Link href={`/creators/${creator.slug}`}>
                      <strong>{creator.name}</strong>
                    </Link>
                    <span className="text-sm text-muted">
                      {creator.roleLabel || creatorRoleLabel(creator.roleKey)}
                      {creator.originalName ? ` / ${creator.originalName}` : ""}
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
            {work.characters.length > 0 ? (
              <ChipList
                items={work.characters.map((character) => ({
                  href: `/games?character=${encodeURIComponent(character.slug)}`,
                  label: character.primaryName,
                }))}
              />
            ) : (
              <p className="text-sm text-muted">未填写。</p>
            )}
          </section>
          <section>
            <h3>标签</h3>
            {work.tags.length > 0 ? (
              <ChipList
                items={work.tags.map((tag) => ({
                  href: `/games?tag=${encodeURIComponent(tag.slug)}`,
                  label: tag.name,
                }))}
              />
            ) : (
              <p className="text-sm text-muted">未填写。</p>
            )}
          </section>
          <section>
            <h3>系列</h3>
            {work.series.length > 0 ? (
              <ul className="mt-3 grid gap-3">
                {work.series.map((item) => (
                  <li key={item.seriesId}>
                    <Link href={`/series/${item.slug}`}>
                      <strong>{item.title}</strong>
                    </Link>
                    <span className="text-sm text-muted">{item.positionLabel || item.relationKind}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">未填写。</p>
            )}
          </section>
          <section>
            <h3>外部链接</h3>
            {work.externalLinks.length > 0 ? (
              <ul className="mt-3 grid gap-3">
                {work.externalLinks.map((link) => (
                  <li key={link.id}>
                    <a href={link.url} rel="noreferrer" target="_blank">
                      {link.label}
                    </a>
                    <span className="text-sm text-muted">{linkTypeLabel(link.linkType)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">未填写。</p>
            )}
          </section>
          <section>
            <h3>相关作品</h3>
            {work.relations.length > 0 ? (
              <ul className="mt-3 grid gap-3">
                {work.relations.map((relation) => (
                  <li key={`${relation.direction}-${relation.workId}-${relation.relationType}`}>
                    <Link href={`/games/${relation.slug}`}>{relation.title}</Link>
                    <span className="text-sm text-muted">
                      {relationLabel(relation.relationType, relation.direction)}
                    </span>
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

function ArchiveBadges({ archive }: { archive: GameArchiveVersionDetail }) {
  return (
    <ChipList
      compact
      items={[
        ...(archive.isCurrent ? [{ label: "当前" }] : []),
        { label: archive.language },
        { label: archive.isProofread ? "已校对" : "未校对" },
        { label: archive.isImageEdited ? "已修图" : "未修图" },
      ]}
    />
  );
}

function ArchiveActions({ archiveId, canPlayInBrowser }: { archiveId: number; canPlayInBrowser: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        className={buttonVariants()}
        href={`/api/archive-versions/${archiveId}/download?zip_builder=${downloadZipBuilderVersion}`}
      >
        下载 ZIP
      </a>
      {canPlayInBrowser ? (
        <Link className={buttonVariants({ variant: "outline" })} href={`/play/${archiveId}`}>
          在线游玩
        </Link>
      ) : (
        <span className="text-sm text-muted">暂不支持在线游玩</span>
      )}
    </div>
  );
}

function linkTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    official: "官方网站",
    wiki: "资料页面",
    source: "来源",
    video: "视频",
    download_page: "下载页",
  };

  return labels[value] ?? "其他";
}

function relationLabel(value: string, direction: "from" | "to"): string {
  const labels: Record<string, string> = {
    prequel: direction === "from" ? "前作" : "后作",
    sequel: direction === "from" ? "后作" : "前作",
    side_story: "外传",
    same_setting: "同世界观",
    remake: "重制",
    remaster: "高清/重制",
    fan_disc: "Fan disc",
    alternate_version: "异版本",
    translation_source: "翻译来源",
    inspired_by: "受其影响",
  };

  return labels[value] ?? "相关";
}

function formatDateish(value: string | null, precision: string): string {
  if (!value || precision === "unknown") {
    return "日期未知";
  }

  return value;
}

function pickCurrentArchive(work: {
  releases: Array<{
    archiveVersions: Array<{
      id: number;
      archiveLabel: string;
      isCurrent: boolean;
      totalFiles: number;
      totalSizeBytes: number;
    }>;
  }>;
}): {
  id: number;
  archiveLabel: string;
  totalFiles: number;
  totalSizeBytes: number;
} | null {
  for (const release of work.releases) {
    for (const archive of release.archiveVersions) {
      if (archive.isCurrent) {
        return archive;
      }
    }
  }
  return null;
}
