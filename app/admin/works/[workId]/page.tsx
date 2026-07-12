import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import {
  getWorkForAdminEdit,
  listAdminReleasesForWork,
} from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatUnreadCount, formatNumber } from "@/lib/format";
import {
  baseVariantLabel,
  releaseTypeLabel,
  workStatusBadgeClass,
  workStatusLabel,
} from "@/lib/labels";

export const dynamic = "force-dynamic";

type AdminWorkEditPageProps = {
  params: Promise<{
    workId: string;
  }>;
};

export default async function AdminWorkEditPage({ params }: AdminWorkEditPageProps) {
  const { workId: rawWorkId } = await params;
  const workId = parseWorkId(rawWorkId);
  const adminUser = await requireAdminPageUser(`/admin/works/${workId}`);
  const [work, releases, unreadInboxCount] = await Promise.all([
    getWorkForAdminEdit(workId),
    listAdminReleasesForWork(workId),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  if (!work) {
    notFound();
  }

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Edit Work</p>
          <h1>{work.chineseTitle || work.originalTitle}</h1>
        </div>
        <div className="actions header-actions">
          <Link className="button primary" href="/admin/works">
            返回作品维护
          </Link>
          <Link className="button" href="/inbox">
            站内信
            {unreadInboxCount > 0 ? (
              <span className="notification-badge">
                {formatUnreadCount(unreadInboxCount)}
              </span>
            ) : null}
          </Link>
        </div>
      </header>

      <form
        action={`/api/admin/works/${work.id}/update`}
        className="card form-card stack-form"
        method="post"
      >
        <input name="work_id" type="hidden" value={work.id} />

        <section className="form-section">
          <h2>基础资料</h2>
          <div className="upload-form-grid">
            <label className="field">
              原名
              <input readOnly value={work.originalTitle} />
              <span className="muted-line">不可修改</span>
            </label>
            <label className="field">
              Slug
              <input readOnly value={work.slug} />
              <span className="muted-line">不可修改</span>
            </label>
            <label className="field">
              中文名
              <input
                defaultValue={work.chineseTitle ?? ""}
                name="chinese_title"
                type="text"
              />
            </label>
            <label className="field">
              排序名
              <input defaultValue={work.sortTitle ?? ""} name="sort_title" type="text" />
            </label>
            <label className="field">
              原作发布日期
              <input
                defaultValue={work.originalReleaseDate ?? ""}
                name="original_release_date"
                placeholder="YYYY-MM-DD / YYYY-MM / YYYY"
                type="text"
              />
            </label>
            <label className="field">
              日期精度
              <select
                defaultValue={work.originalReleasePrecision}
                name="original_release_precision"
              >
                <option value="unknown">未知</option>
                <option value="year">年</option>
                <option value="month">月</option>
                <option value="day">日</option>
              </select>
            </label>
            <label className="field">
              引擎
              <select defaultValue={work.engineFamily} name="engine_family">
                <option value="rpg_maker_2000">RPG Maker 2000</option>
                <option value="rpg_maker_2003">RPG Maker 2003</option>
                <option value="mixed">混合</option>
                <option value="unknown">未知</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label className="field">
              引擎备注
              <input defaultValue={work.engineDetail ?? ""} name="engine_detail" type="text" />
            </label>
            <label className="field">
              状态
              <select defaultValue={work.status} name="status">
                <option value="published">已发布</option>
                <option value="hidden">隐藏</option>
                <option value="draft">草稿</option>
              </select>
            </label>
            <label className="checkbox-line">
              <input
                defaultChecked={work.usesManiacsPatch}
                name="uses_maniacs_patch"
                type="checkbox"
                value="1"
              />
              使用 Maniacs Patch
            </label>
            <label className="field">
              图标 blob SHA-256
              <input
                defaultValue={work.iconBlobSha256 ?? ""}
                name="icon_blob_sha256"
                type="text"
              />
            </label>
            <label className="field">
              缩略图 blob SHA-256
              <input
                defaultValue={work.thumbnailBlobSha256 ?? ""}
                name="thumbnail_blob_sha256"
                type="text"
              />
            </label>
            <label className="field wide-field">
              简介
              <textarea
                defaultValue={work.description ?? ""}
                name="description"
                rows={6}
              />
            </label>
          </div>
        </section>

        <section className="form-section">
          <h2>检索辅助</h2>
          <div className="upload-form-grid">
            <label className="field">
              别名
              <textarea
                defaultValue={work.aliases.join("\n")}
                name="aliases"
                rows={5}
              />
              <span className="muted-line">每行一个别名。</span>
            </label>
            <label className="field">
              标签
              <textarea defaultValue={work.tags.join("\n")} name="tags" rows={5} />
              <span className="muted-line">每行一个，或使用逗号分隔。</span>
            </label>
            <label className="field">
              登场角色
              <textarea
                defaultValue={work.characterCredits
                  .map((character) =>
                    [
                      character.primaryName,
                      character.roleKey,
                      character.sortOrder ?? "",
                      character.notes ?? "",
                    ].join("|"),
                  )
                  .join("\n")}
                name="characters"
                placeholder="艾露莎|main|1|初代主角"
                rows={5}
              />
              <span className="muted-line">
                每行一个角色，字段用 | 分隔；职务：main、supporting、cameo、mentioned、other。
              </span>
            </label>
            <label className="field">
              浏览图 blob SHA-256
              <textarea
                defaultValue={work.media
                  .filter((media) => media.kind === "preview")
                  .map((media) => media.blobSha256)
                  .join("\n")}
                name="preview_blob_sha256s"
                rows={5}
              />
              <span className="muted-line">每行一个图片 blob SHA-256；第一行作为主浏览图。</span>
            </label>
            <label className="field wide-field">
              系列成员
              <textarea
                defaultValue={work.series
                  .map((item) =>
                    [
                      item.slug,
                      item.title,
                      item.positionNumber ?? "",
                      item.positionLabel ?? "",
                      item.relationKind,
                      "",
                    ].join("|"),
                  )
                  .join("\n")}
                name="series_memberships"
                placeholder="勇者系列|勇者系列|1|第一作|main|正篇"
                rows={5}
              />
              <span className="muted-line">
                每行一个系列，字段用 | 分隔；关系：main、side、collection_member、same_setting、other。
              </span>
            </label>
            <label className="field wide-field">
              相关作品
              <textarea
                defaultValue={work.outgoingRelations
                  .map((relation) =>
                    [relation.slug, relation.relationType, relation.notes ?? ""].join("|"),
                  )
                  .join("\n")}
                name="outgoing_relations"
                placeholder="勇者传说-前篇|sequel|承接前作"
                rows={5}
              />
              <span className="muted-line">
                每行一个作品，字段用 | 分隔；关系：prequel、sequel、side_story、same_setting、remake、remaster、fan_disc、alternate_version、translation_source、inspired_by、other。
              </span>
            </label>
            <label className="field wide-field">
              外部链接
              <textarea
                defaultValue={work.externalLinks
                  .map((link) => `${link.label}|${link.url}|${link.linkType}`)
                  .join("\n")}
                name="external_links"
                placeholder="官方网站|https://example.com|official"
                rows={5}
              />
              <span className="muted-line">
                每行一个链接，字段用 | 分隔；类型：official、wiki、source、video、download_page、other。
              </span>
            </label>
          </div>
        </section>

        <div className="actions">
          <button className="button primary" type="submit">
            保存资料
          </button>
          {work.status === "published" ? (
            <Link className="button" href={`/games/${work.slug}`}>
              查看公开页
            </Link>
          ) : null}
        </div>
      </form>

      <section className="table-wrap admin-related-table" aria-label="发布版本">
        <table className="data-table">
          <thead>
            <tr>
              <th>发布版本</th>
              <th>状态</th>
              <th>归档</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {releases.map((release) => (
              <tr key={release.id}>
                <td>
                  <strong>{release.label}</strong>
                  <span className="mono muted-line">{release.key}</span>
                  <span className="muted-line">
                    {baseVariantLabel(release.baseVariant)} / {releaseTypeLabel(release.type)}
                    {release.releaseDate ? ` / ${release.releaseDate}` : ""}
                  </span>
                </td>
                <td>
                  <span className={`badge ${workStatusBadgeClass(release.status)}`}>
                    {workStatusLabel(release.status)}
                  </span>
                </td>
                <td>
                  {formatNumber(release.archiveVersionCount)} 个快照
                  <span className="muted-line">
                    当前：{formatNumber(release.currentArchiveVersionCount)}
                  </span>
                </td>
                <td>
                  <Link className="button primary" href={`/admin/releases/${release.id}`}>
                    编辑发布版本
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function parseWorkId(value: string): number {
  const workId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(workId) || workId <= 0) {
    notFound();
  }

  return workId;
}
