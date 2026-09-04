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
import { listCharacterSuggestions } from "@/lib/server/db/taxonomy-library";
import { countUnreadInboxItemsForUser } from "@/lib/server/db/inbox";
import { getRelationEditorCapabilities } from "@/lib/authz/permissions";
import { RelationEditor } from "@/app/games/[id]/relation-editor";
import { AdminLanguageField } from "../language-field";
import { StickySaveBar } from "@/app/admin/admin-list-controls";
import { StructuredWorkFields } from "../structured-work-fields";

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
  const [work, unreadInboxCount, characterSuggestions] = await Promise.all([
    getWorkForAdminEdit(workId),
    countUnreadInboxItemsForUser(adminUser),
    listCharacterSuggestions(),
  ]);
  if (!work) notFound();
  const relationCapabilities = getRelationEditorCapabilities(adminUser);
  return (
    <main>
      <PageHeader
        compact
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
                aria-label="日期精度"
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
                aria-label="引擎"
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
                  { value: "other", label: "其他" },
                ]}
              />
            </FormField>
            <FormField label="状态">
              <SelectField
                aria-label="状态"
                defaultValue={work.status}
                name="status"
                options={[
                  { value: "published", label: "已发布" },
                  { value: "hidden", label: "隐藏" },
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
            <div className="md:col-span-2">
              <StructuredWorkFields
                characterSuggestions={characterSuggestions}
                characters={work.characters}
                externalLinks={work.externalLinks}
                previewBlobSha256s={work.media.filter((media) => media.kind === "preview").map((media) => media.blobSha256)}
                tags={work.tags}
              />
            </div>
          </div>
        </Pane>
        <StickySaveBar>
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
        </StickySaveBar>
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
