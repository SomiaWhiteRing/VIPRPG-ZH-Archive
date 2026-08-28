import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import { CheckboxField } from "@/app/components/ui/checkbox-field";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { InboxLink } from "@/app/components/ui/inbox-link";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { getWorkForAdminEdit } from "@/lib/server/db/game-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { getRelationEditorCapabilities } from "@/lib/authz/permissions";
import { RelationEditor } from "@/app/games/[id]/relation-editor";
import { AdminLanguageField } from "../language-field";

export const dynamic = "force-dynamic";

export default async function AdminWorkEditPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const workId = parseId((await params).workId);
  const adminUser = await requirePagePermission(
    `/admin/works/${workId}`,
    "work.update",
  );
  const [work, unreadInboxCount] = await Promise.all([
    getWorkForAdminEdit(workId),
    countUnreadInboxItemsForUser(adminUser),
  ]);
  if (!work) notFound();
  const relationCapabilities = getRelationEditorCapabilities(adminUser);
  return (
    <main>
      <PageHeader
        title={work.chineseTitle || work.originalTitle}
        actions={
          <>
            <BackLink href="/admin/works" label="返回游戏维护" />
            <InboxLink unread={unreadInboxCount} />
          </>
        }
      />
      <form
        action={`/api/admin/works/${work.id}/update`}
        className="grid gap-4"
        method="post"
      >
        <input name="work_id" type="hidden" value={work.id} />
        <Pane heading="游戏资料">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField hint="不可修改" label="原名">
              <Input readOnly value={work.originalTitle} />
            </FormField>
            <FormField label="中文名">
              <Input
                defaultValue={work.chineseTitle ?? ""}
                name="chinese_title"
              />
            </FormField>
            <FormField label="原作发布日期">
              <Input
                defaultValue={work.originalReleaseDate ?? ""}
                name="original_release_date"
                placeholder="YYYY-MM-DD / YYYY-MM / YYYY"
              />
            </FormField>
            <FormField label="日期精度">
              <SelectField
                defaultValue={work.originalReleasePrecision}
                name="original_release_precision"
                options={[
                  { value: "unknown", label: "未知" },
                  { value: "year", label: "年" },
                  { value: "month", label: "月" },
                  { value: "day", label: "日" },
                ]}
              />
            </FormField>
            <AdminLanguageField value={work.language} />
            <CheckboxField
              defaultChecked={work.isOriginal}
              label="本站原创"
              name="is_original"
            />
            <FormField label="引擎">
              <SelectField
                defaultValue={work.engineFamily}
                name="engine_family"
                options={[
                  { value: "rpg_maker_2000", label: "RPG Maker 2000" },
                  { value: "rpg_maker_2003", label: "RPG Maker 2003" },
                  { value: "rpg_maker_2003_maniac", label: "RPG Maker 2003 Maniac" },
                  { value: "rpg_maker_xp", label: "RPG Maker XP" },
                  { value: "rpg_maker_vx", label: "RPG Maker VX" },
                  { value: "rpg_maker_vx_ace", label: "RPG Maker VX Ace" },
                  { value: "rpg_maker_mv", label: "RPG Maker MV" },
                  { value: "rpg_maker_mz", label: "RPG Maker MZ" },
                  { value: "rpg_maker_unite", label: "RPG Maker Unite" },
                  { value: "mixed", label: "混合" },
                  { value: "unknown", label: "未知" },
                  { value: "other", label: "其他" },
                ]}
              />
            </FormField>
            <FormField label="状态">
              <SelectField
                defaultValue={work.status}
                name="status"
                options={[
                  { value: "published", label: "已发布" },
                  { value: "hidden", label: "隐藏" },
                  { value: "draft", label: "草稿" },
                ]}
              />
            </FormField>
            <FormField label="简介" wide>
              <Textarea
                defaultValue={work.description ?? ""}
                name="description"
                rows={6}
              />
            </FormField>
          </div>
        </Pane>
        <Pane heading="作者、标签与资料">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField hint="每行一个别名。" label="别名">
              <Textarea
                defaultValue={work.aliases.join("\n")}
                name="aliases"
                rows={5}
              />
            </FormField>
            <FormField hint="每行一个标签。" label="标签">
              <Textarea
                defaultValue={work.tags.join("\n")}
                name="tags"
                rows={5}
              />
            </FormField>
            <FormField hint="每行一个角色名。" label="登场角色">
              <Textarea
                defaultValue={work.characters.join("\n")}
                name="characters"
                rows={5}
              />
            </FormField>
            <FormField
              hint="每行一个图片 blob SHA-256；第一行作为主浏览图。"
              label="浏览图"
            >
              <Textarea
                defaultValue={work.media
                  .filter((media) => media.kind === "preview")
                  .map((media) => media.blobSha256)
                  .join("\n")}
                name="preview_blob_sha256s"
                rows={5}
              />
            </FormField>
            <FormField
              hint="每行：名称|网址|类型；字段中的 | 写成 \|。"
              label="外部链接"
              wide
            >
              <Textarea
                defaultValue={work.externalLinks
                  .map((link) =>
                    [link.label, link.url, link.linkType]
                      .map(escapeLinkPart)
                      .join("|"),
                  )
                  .join("\n")}
                name="external_links"
                rows={5}
              />
            </FormField>
          </div>
        </Pane>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">保存游戏资料</Button>
          {work.status === "published" ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/games/${work.id}`}
            >
              查看公开页
            </Link>
          ) : null}
          <Link
            className={buttonVariants({ variant: "outline" })}
            href="/admin/archive-versions"
          >
            查看归档历史
          </Link>
        </div>
      </form>
      <Pane heading="关系资料">
        <p className="text-sm text-muted">
          普通关联、原版/译版关联和目录成员在上传完成后单独维护，不与游戏资料保存混在一起。
        </p>
        <RelationEditor
          {...relationCapabilities}
          currentUserId={adminUser.id}
          language={work.language}
          parallelTranslations={work.parallelTranslations}
          relations={work.outgoingRelations}
          translations={work.translations}
          workId={work.id}
        />
      </Pane>
    </main>
  );
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  return id;
}
function escapeLinkPart(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}
