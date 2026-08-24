import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatusBadge } from "@/app/components/ui/status-badge";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { getReleaseForAdminEdit } from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { formatNumber, formatBytes } from "@/lib/format";

export const dynamic = "force-dynamic";

type AdminReleaseEditPageProps = {
  params: Promise<{
    releaseId: string;
  }>;
};

export default async function AdminReleaseEditPage({ params }: AdminReleaseEditPageProps) {
  const { releaseId: rawReleaseId } = await params;
  const releaseId = parseReleaseId(rawReleaseId);
  const adminUser = await requirePagePermission(`/admin/releases/${releaseId}`, "release.update");
  const [release, unreadInboxCount] = await Promise.all([
    getReleaseForAdminEdit(releaseId),
    countUnreadInboxItemsForUser(adminUser),
  ]);

  if (!release) {
    notFound();
  }

  return (
    <main>
      <PageHeader
        eyebrow="编辑发布版本"
        title={release.label}
        subtitle={`所属作品：${release.workTitle}`}
        actions={
          <>
            <BackLink href={`/admin/works/${release.workId}`} label="返回作品资料" />
            <Link className={buttonVariants({ variant: "outline" })} href={`/games/${release.workSlug}`}>
              查看公开页
            </Link>
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />

      <form action={`/api/admin/releases/${release.id}/update`} className="grid gap-4 grid gap-4" method="post">
        <input name="release_id" type="hidden" value={release.id} />

        <Pane heading="发布版本资料">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField hint="不可修改" label="发布版本 key">
              <Input readOnly value={release.key} />
            </FormField>
            <FormField label="发布版本名称">
              <Input defaultValue={release.label} name="release_label" required type="text" />
            </FormField>
            <FormField label="基底版本">
              <SelectField
                defaultValue={release.baseVariant}
                name="base_variant"
                options={[
                  { value: "original", label: "原版" },
                  { value: "remake", label: "重制版" },
                  { value: "other", label: "其他基底" },
                ]}
              />
            </FormField>
            <FormField label="分支标签">
              <Input defaultValue={release.variantLabel} name="variant_label" required type="text" />
            </FormField>
            <FormField label="发布版本类型">
              <SelectField
                defaultValue={release.type}
                name="release_type"
                options={[
                  { value: "original", label: "原始发布" },
                  { value: "translation", label: "汉化版" },
                  { value: "revision", label: "修正版" },
                  { value: "localized_revision", label: "本地化修正版" },
                  { value: "demo", label: "试玩版" },
                  { value: "event_submission", label: "活动投稿" },
                  { value: "patch_applied_full_release", label: "补丁整合版" },
                  { value: "repack", label: "重打包" },
                  { value: "other", label: "其他" },
                ]}
              />
            </FormField>
            <FormField label="状态">
              <SelectField
                defaultValue={release.status}
                name="status"
                options={[
                  { value: "published", label: "已发布" },
                  { value: "hidden", label: "隐藏" },
                  { value: "draft", label: "草稿" },
                ]}
              />
            </FormField>
            <FormField label="发布日期">
              <Input
                defaultValue={release.releaseDate ?? ""}
                name="release_date"
                placeholder="YYYY-MM-DD / YYYY-MM / YYYY"
                type="text"
              />
            </FormField>
            <FormField label="日期精度">
              <SelectField
                defaultValue={release.releaseDatePrecision}
                name="release_date_precision"
                options={[
                  { value: "unknown", label: "未知" },
                  { value: "year", label: "年" },
                  { value: "month", label: "月" },
                  { value: "day", label: "日" },
                ]}
              />
            </FormField>
            <FormField label="来源名称">
              <Input defaultValue={release.sourceName ?? ""} name="source_name" type="text" />
            </FormField>
            <FormField label="来源链接">
              <Input defaultValue={release.sourceUrl ?? ""} name="source_url" type="url" />
            </FormField>
            <FormField label="可执行入口">
              <Input
                defaultValue={release.executablePath ?? ""}
                name="executable_path"
                placeholder="RPG_RT.exe"
                type="text"
              />
            </FormField>
            <FormField hint="每行一个标签；也可用逗号分隔。" label="标签">
              <Textarea defaultValue={release.tags.join("\n")} name="tags" placeholder="短篇" rows={5} />
            </FormField>
            <FormField label="版权/授权备注" wide>
              <Textarea defaultValue={release.rightsNotes ?? ""} name="rights_notes" rows={4} />
            </FormField>
            <FormField
              hint="每行一个链接，字段用 | 分隔；类型：official、source、download_page、patch_note、other。"
              label="外部链接"
              wide
            >
              <Textarea
                defaultValue={release.externalLinks
                  .map((link) => `${link.label}|${link.url}|${link.linkType}`)
                  .join("\n")}
                name="external_links"
                placeholder="补丁说明|https://example.com/patch|patch_note"
                rows={5}
              />
            </FormField>
          </div>
        </Pane>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">保存发布版本</Button>
        </div>
      </form>

      <TableWrap label="文件版本">
        <thead>
          <tr>
            <th>文件版本</th>
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
                <span className="font-mono text-sm text-primary text-sm text-muted">
                  #{archive.id} {archive.archiveKey} / {archive.language}
                </span>
                {archive.uploaderName ? (
                  <span className="text-sm text-muted">上传者：{archive.uploaderName}</span>
                ) : null}
              </td>
              <td>
                <StatusBadge kind="archive" value={archive.status} />
                {archive.isCurrent ? <span className="text-sm text-muted">当前版本</span> : null}
                <span className="text-sm text-muted">
                  {archive.isProofread ? "已校对" : "未校对"} / {archive.isImageEdited ? "已修图" : "未修图"}
                </span>
              </td>
              <td>
                {formatNumber(archive.totalFiles)} 文件
                <span className="text-sm text-muted">{formatBytes(archive.totalSizeBytes)}</span>
              </td>
              <td>
                <Link className={buttonVariants()} href={`/admin/archive-versions/${archive.id}`}>
                  编辑
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </main>
  );
}

function parseReleaseId(value: string): number {
  const releaseId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(releaseId) || releaseId <= 0) {
    notFound();
  }

  return releaseId;
}
