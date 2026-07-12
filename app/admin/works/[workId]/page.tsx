import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { SectionHeading } from "@/app/components/ui/section-heading";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requireAdminPageUser } from "@/lib/server/auth/guards";
import {
  getWorkForAdminEdit,
  listAdminReleasesForWork,
} from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatNumber } from "@/lib/format";
import {
  baseVariantLabel,
  releaseTypeLabel,
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
      <PageHeader
        eyebrow="Edit Work"
        title={work.chineseTitle || work.originalTitle}
        actions={
          <>
            <BackLink href="/admin/works" label="返回作品维护" />
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <form
        action={`/api/admin/works/${work.id}/update`}
        className="card form-card stack-form"
        method="post"
      >
        <input name="work_id" type="hidden" value={work.id} />

        <section className="form-section">
          <SectionHeading title="基础资料" />
          <div className="upload-form-grid">
            <FormField hint="不可修改" label="原名">
              <input readOnly value={work.originalTitle} />
            </FormField>
            <FormField hint="不可修改" label="Slug">
              <input readOnly value={work.slug} />
            </FormField>
            <FormField label="中文名">
              <input
                defaultValue={work.chineseTitle ?? ""}
                name="chinese_title"
                type="text"
              />
            </FormField>
            <FormField label="排序名">
              <input defaultValue={work.sortTitle ?? ""} name="sort_title" type="text" />
            </FormField>
            <FormField label="原作发布日期">
              <input
                defaultValue={work.originalReleaseDate ?? ""}
                name="original_release_date"
                placeholder="YYYY-MM-DD / YYYY-MM / YYYY"
                type="text"
              />
            </FormField>
            <FormField label="日期精度">
              <select
                defaultValue={work.originalReleasePrecision}
                name="original_release_precision"
              >
                <option value="unknown">未知</option>
                <option value="year">年</option>
                <option value="month">月</option>
                <option value="day">日</option>
              </select>
            </FormField>
            <FormField label="引擎">
              <select defaultValue={work.engineFamily} name="engine_family">
                <option value="rpg_maker_2000">RPG Maker 2000</option>
                <option value="rpg_maker_2003">RPG Maker 2003</option>
                <option value="mixed">混合</option>
                <option value="unknown">未知</option>
                <option value="other">其他</option>
              </select>
            </FormField>
            <FormField label="引擎备注">
              <input defaultValue={work.engineDetail ?? ""} name="engine_detail" type="text" />
            </FormField>
            <FormField label="状态">
              <select defaultValue={work.status} name="status">
                <option value="published">已发布</option>
                <option value="hidden">隐藏</option>
                <option value="draft">草稿</option>
              </select>
            </FormField>
            <label className="checkbox-line">
              <input
                defaultChecked={work.usesManiacsPatch}
                name="uses_maniacs_patch"
                type="checkbox"
                value="1"
              />
              使用 Maniacs Patch
            </label>
            <FormField label="图标 blob SHA-256">
              <input
                defaultValue={work.iconBlobSha256 ?? ""}
                name="icon_blob_sha256"
                type="text"
              />
            </FormField>
            <FormField label="缩略图 blob SHA-256">
              <input
                defaultValue={work.thumbnailBlobSha256 ?? ""}
                name="thumbnail_blob_sha256"
                type="text"
              />
            </FormField>
            <FormField label="简介" wide>
              <textarea
                defaultValue={work.description ?? ""}
                name="description"
                rows={6}
              />
            </FormField>
          </div>
        </section>

        <section className="form-section">
          <SectionHeading title="检索辅助" />
          <div className="upload-form-grid">
            <FormField hint="每行一个别名。" label="别名">
              <textarea
                defaultValue={work.aliases.join("\n")}
                name="aliases"
                rows={5}
              />
            </FormField>
            <FormField hint="每行一个，或使用逗号分隔。" label="标签">
              <textarea defaultValue={work.tags.join("\n")} name="tags" rows={5} />
            </FormField>
            <FormField
              hint="每行一个角色，字段用 | 分隔；职务：main、supporting、cameo、mentioned、other。"
              label="登场角色"
            >
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
            </FormField>
            <FormField
              hint="每行一个图片 blob SHA-256；第一行作为主浏览图。"
              label="浏览图 blob SHA-256"
            >
              <textarea
                defaultValue={work.media
                  .filter((media) => media.kind === "preview")
                  .map((media) => media.blobSha256)
                  .join("\n")}
                name="preview_blob_sha256s"
                rows={5}
              />
            </FormField>
            <FormField
              hint="每行一个系列，字段用 | 分隔；关系：main、side、collection_member、same_setting、other。"
              label="系列成员"
              wide
            >
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
            </FormField>
            <FormField
              hint="每行一个作品，字段用 | 分隔；关系：prequel、sequel、side_story、same_setting、remake、remaster、fan_disc、alternate_version、translation_source、inspired_by、other。"
              label="相关作品"
              wide
            >
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
            </FormField>
            <FormField
              hint="每行一个链接，字段用 | 分隔；类型：official、wiki、source、video、download_page、other。"
              label="外部链接"
              wide
            >
              <textarea
                defaultValue={work.externalLinks
                  .map((link) => `${link.label}|${link.url}|${link.linkType}`)
                  .join("\n")}
                name="external_links"
                placeholder="官方网站|https://example.com|official"
                rows={5}
              />
            </FormField>
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

      <TableWrap label="发布版本">
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
                  <StatusBadge kind="publication" value={release.status} />
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
      </TableWrap>
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
