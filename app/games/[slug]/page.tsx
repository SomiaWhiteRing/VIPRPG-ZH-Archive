import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { ChipList } from "@/app/components/ui/chip-list";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { StatList } from "@/app/components/ui/stat-list";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { downloadZipBuilderVersion } from "@/lib/archive/download";
import { getGameWorkDetail } from "@/lib/server/db/game-library";
import { formatNumber, formatBytes } from "@/lib/format";
import {
  baseVariantLabel,
  creatorRoleLabel,
  engineLabel,
  releaseTypeLabel,
} from "@/lib/labels";
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
        eyebrow="Game Work"
        subtitle={work.chineseTitle ? work.originalTitle : undefined}
        title={title}
      />

      {currentArchive ? (
        <WorkActionBar
          archiveId={currentArchive.id}
          archiveLabel={currentArchive.archiveLabel}
          downloadHref={`/api/archive-versions/${currentArchive.id}/download?zip_builder=${downloadZipBuilderVersion}`}
          totalFiles={currentArchive.totalFiles}
          totalSizeBytes={currentArchive.totalSizeBytes}
          canPlayInBrowser={!work.usesManiacsPatch}
        />
      ) : (
        <section className="work-action-bar" aria-label="主操作">
          <span className="work-action-meta">
            该作品暂无可下载的最新快照，可在版本列表中选择历史快照。
          </span>
        </section>
      )}

      <section className="work-hero">
        <div className="work-hero-media">
          {primaryMedia ? (
            <Image
              alt={title}
              height={360}
              src={`/api/media/blobs/${primaryMedia}`}
              unoptimized
              width={640}
            />
          ) : (
            <span>{engineLabel(work.engineFamily)}</span>
          )}
        </div>
        <div className="work-hero-info">
          <ChipList
            items={[
              { label: engineLabel(work.engineFamily) },
              ...(work.usesManiacsPatch ? [{ label: "Maniacs Patch" }] : []),
              ...work.tags.map((tag) => ({
                href: `/games?tag=${encodeURIComponent(tag.slug)}`,
                label: tag.name,
              })),
            ]}
          />
          {work.description ? <p>{work.description}</p> : null}
          <StatList
            items={[
              {
                label: "原作发布日期",
                value: formatDateish(work.originalReleaseDate, work.originalReleasePrecision),
              },
              { label: "发布分支", value: formatNumber(work.releaseCount) },
              { label: "归档快照", value: formatNumber(work.archiveVersionCount) },
              { label: "当前归档容量", value: formatBytes(work.totalSizeBytes) },
            ]}
          />
        </div>
      </section>

      <section className="section-grid work-meta-grid" aria-label="作品资料">
        <Pane heading="名称">
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
        </Pane>

        <Pane heading="制作人员">
          {work.creators.length > 0 ? (
            <ul className="plain-list">
              {work.creators.map((creator) => (
                <li key={`${creator.slug}-${creator.roleKey}`}>
                  <Link href={`/creators/${creator.slug}`}>
                    <strong>{creator.name}</strong>
                  </Link>
                  <span className="muted-line">
                    {creator.roleLabel || creatorRoleLabel(creator.roleKey)}
                    {creator.originalName ? ` / ${creator.originalName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-line">未填写。</p>
          )}
        </Pane>

        <Pane heading="登场角色">
          {work.characters.length > 0 ? (
            <ChipList
              items={work.characters.map((character) => ({
                href: `/games?character=${encodeURIComponent(character.slug)}`,
                label: character.primaryName,
              }))}
            />
          ) : (
            <p className="muted-line">未填写。</p>
          )}
        </Pane>

        <Pane heading="外部链接">
          {work.externalLinks.length > 0 ? (
            <ul className="plain-list">
              {work.externalLinks.map((link) => (
                <li key={link.id}>
                  <a href={link.url} rel="noreferrer" target="_blank">
                    {link.label}
                  </a>
                  <span className="muted-line">{linkTypeLabel(link.linkType)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-line">未填写。</p>
          )}
        </Pane>
      </section>

      {work.media.length > 1 ? (
        <section className="work-preview-strip" aria-label="浏览图">
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

      {(work.series.length > 0 || work.relations.length > 0) ? (
        <section className="section-grid work-meta-grid" aria-label="作品关系">
          {work.series.length > 0 ? (
            <Pane heading="系列">
              <ul className="plain-list">
                {work.series.map((item) => (
                  <li key={item.seriesId}>
                    <Link href={`/series/${item.slug}`}>
                      <strong>{item.title}</strong>
                    </Link>
                    <span className="muted-line">
                      {item.positionLabel || item.relationKind}
                    </span>
                  </li>
                ))}
              </ul>
            </Pane>
          ) : null}
          {work.relations.length > 0 ? (
            <Pane heading="相关作品">
              <ul className="plain-list">
                {work.relations.map((relation) => (
                  <li key={`${relation.direction}-${relation.workId}-${relation.relationType}`}>
                    <Link href={`/games/${relation.slug}`}>{relation.title}</Link>
                    <span className="muted-line">
                      {relationLabel(relation.relationType, relation.direction)}
                    </span>
                  </li>
                ))}
              </ul>
            </Pane>
          ) : null}
        </section>
      ) : null}

      <section className="release-list" aria-label="发布版本">
        <SectionHeading title="发布版本与归档" />
        {work.releases.map((release) => (
          <Pane
            compact
            heading={release.label}
            headingAction={
              release.sourceUrl ? (
                <a className="button" href={release.sourceUrl} rel="noreferrer" target="_blank">
                  来源
                </a>
              ) : null
            }
            headingLevel={3}
            key={release.id}
          >
            <p className="muted-line">
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
            <TableWrap compact label={`${release.label}归档列表`} minWidth={980}>
              <thead>
                <tr>
                  <th>归档</th>
                  <th>状态</th>
                  <th>规模</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {release.archiveVersions.map((archive) => (
                  <tr key={archive.id}>
                    <td>
                      <strong>{archive.archiveLabel}</strong>
                      <span className="mono muted-line">{archive.archiveKey}</span>
                      {archive.uploaderName ? (
                        <span className="muted-line">上传者：{archive.uploaderName}</span>
                      ) : null}
                    </td>
                    <td>
                      <ChipList
                        compact
                        items={[
                          ...(archive.isCurrent ? [{ label: "当前" }] : []),
                          { label: archive.language },
                          { label: archive.isProofread ? "已校对" : "未校对" },
                          { label: archive.isImageEdited ? "已修图" : "未修图" },
                        ]}
                      />
                    </td>
                    <td>
                      {formatNumber(archive.totalFiles)} 文件
                      <span className="muted-line">
                        {formatBytes(archive.totalSizeBytes)}
                      </span>
                    </td>
                    <td>
                      <div className="actions compact-actions">
                        <a
                          className="button primary"
                          href={`/api/archive-versions/${archive.id}/download?zip_builder=${downloadZipBuilderVersion}`}
                        >
                          下载 ZIP
                        </a>
                        {!work.usesManiacsPatch ? (
                          <Link className="button" href={`/play/${archive.id}`}>
                            在线游玩
                          </Link>
                        ) : (
                          <span className="muted-line">暂不支持在线游玩</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Pane>
        ))}
      </section>
    </main>
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
