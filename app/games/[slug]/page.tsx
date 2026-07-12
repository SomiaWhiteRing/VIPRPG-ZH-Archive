import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
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
      <header className="page-header">
        <div>
          <p className="eyebrow">Game Work</p>
          <h1>{title}</h1>
          {work.chineseTitle ? (
            <p className="subtitle">{work.originalTitle}</p>
          ) : null}
        </div>
        <div className="actions header-actions">
          <Link className="button" href="/games">
            返回作品资料库
          </Link>
        </div>
      </header>

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
          <div className="chip-list">
            <span>{engineLabel(work.engineFamily)}</span>
            {work.usesManiacsPatch ? <span>Maniacs Patch</span> : null}
            {work.tags.map((tag) => (
              <Link href={`/games?tag=${encodeURIComponent(tag.slug)}`} key={tag.slug}>
                {tag.name}
              </Link>
            ))}
          </div>
          {work.description ? <p>{work.description}</p> : null}
          <dl className="detail-list work-detail-list">
            <div>
              <dt>原作发布日期</dt>
              <dd>{formatDateish(work.originalReleaseDate, work.originalReleasePrecision)}</dd>
            </div>
            <div>
              <dt>发布分支</dt>
              <dd>{formatNumber(work.releaseCount)}</dd>
            </div>
            <div>
              <dt>归档快照</dt>
              <dd>{formatNumber(work.archiveVersionCount)}</dd>
            </div>
            <div>
              <dt>当前归档容量</dt>
              <dd>{formatBytes(work.totalSizeBytes)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="section-grid work-meta-grid" aria-label="作品资料">
        <section className="card">
          <h2>名称</h2>
          <dl className="detail-list">
            <div>
              <dt>原名</dt>
              <dd>{work.originalTitle}</dd>
            </div>
            <div>
              <dt>中文名</dt>
              <dd>{work.chineseTitle ?? "未填写"}</dd>
            </div>
            <div>
              <dt>别名</dt>
              <dd>{work.aliases.length > 0 ? work.aliases.join(" / ") : "未填写"}</dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <h2>制作人员</h2>
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
        </section>

        <section className="card">
          <h2>登场角色</h2>
          {work.characters.length > 0 ? (
            <div className="chip-list">
              {work.characters.map((character) => (
                <Link
                  href={`/games?character=${encodeURIComponent(character.slug)}`}
                  key={character.slug}
                >
                  {character.primaryName}
                </Link>
              ))}
            </div>
          ) : (
            <p className="muted-line">未填写。</p>
          )}
        </section>

        <section className="card">
          <h2>外部链接</h2>
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
        </section>
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
            <section className="card">
              <h2>系列</h2>
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
            </section>
          ) : null}
          {work.relations.length > 0 ? (
            <section className="card">
              <h2>相关作品</h2>
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
            </section>
          ) : null}
        </section>
      ) : null}

      <section className="release-list" aria-label="发布版本">
        <h2>发布版本与归档</h2>
        {work.releases.map((release) => (
          <article className="release-block" key={release.id}>
            <header>
              <div>
                <h3>{release.label}</h3>
                <p className="muted-line">
                  {releaseTypeLabel(release.type)} / {baseVariantLabel(release.baseVariant)}
                  {" / "}
                  {formatDateish(release.releaseDate, release.releaseDatePrecision)}
                </p>
              </div>
              {release.sourceUrl ? (
                <a className="button" href={release.sourceUrl} rel="noreferrer" target="_blank">
                  来源
                </a>
              ) : null}
            </header>
            {release.rightsNotes ? <p>{release.rightsNotes}</p> : null}
            {release.externalLinks.length > 0 ? (
              <div className="chip-list">
                {release.externalLinks.map((link) => (
                  <a href={link.url} key={link.id} rel="noreferrer" target="_blank">
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}
            {release.staff.length > 0 || release.tags.length > 0 ? (
              <div className="chip-list">
                {release.staff.map((staff) => (
                  <Link href={`/creators/${staff.slug}`} key={`${staff.slug}-${staff.roleKey}`}>
                    {staff.roleLabel || creatorRoleLabel(staff.roleKey)}：{staff.name}
                  </Link>
                ))}
                {release.tags.map((tag) => (
                  <Link href={`/games?tag=${encodeURIComponent(tag.slug)}`} key={tag.slug}>
                    {tag.name}
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="table-wrap compact-table-wrap">
              <table className="data-table release-archive-table">
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
                        <div className="chip-list compact-chip-list">
                          {archive.isCurrent ? <span>当前</span> : null}
                          <span>{archive.language}</span>
                          <span>{archive.isProofread ? "已校对" : "未校对"}</span>
                          <span>{archive.isImageEdited ? "已修图" : "未修图"}</span>
                        </div>
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
              </table>
            </div>
          </article>
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
