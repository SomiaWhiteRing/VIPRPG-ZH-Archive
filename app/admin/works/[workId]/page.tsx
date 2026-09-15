import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import { CheckboxField } from "@/app/components/ui/checkbox-field";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/app/components/ui/back-link";
import { FormField } from "@/app/components/ui/form-field";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { requirePagePermission } from "@/lib/server/auth/authorize";
import { getWorkForAdminEdit } from "@/lib/server/db/game-library";
import { listCharacterSuggestions } from "@/lib/server/db/taxonomy-library";
import { getRelationEditorCapabilities, canMergeWorks, hasPermission } from "@/lib/authz/permissions";
import { RelationEditor } from "@/app/games/[id]/relation-editor";
import { AdminLanguageField } from "../language-field";
import { StickySaveBar } from "@/app/admin/admin-list-controls";
import { StructuredWorkFields } from "../structured-work-fields";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { WorkStaffFields } from "../work-staff-fields";
import { WorkMoreInfoFields } from "@/app/components/work/work-more-info-editor";
import { listCreatorSuggestions } from "@/lib/server/db/creator-library";
import type { StaffCredit } from "@/lib/staff-credits";
import { listWorkMaintainers } from "@/lib/server/db/catalog-maintenance";

export const dynamic = "force-dynamic";

export default async function AdminWorkEditPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const workId = parseId((await params).workId);
  const adminUser = await requirePagePermission(
    `/admin/works/${workId}`,
    "work.metadata.update_any",
  );
  const [work, characterSuggestions, creatorSuggestions] = await Promise.all([
    getWorkForAdminEdit(workId),
    listCharacterSuggestions(),
    listCreatorSuggestions(),
  ]);
  if (!work) notFound();
  const canUpdateStatus = hasPermission(adminUser, "work.status.update_any");
  if (work.status === "deleted" && !canUpdateStatus) notFound();
  const maintainers = hasPermission(adminUser, "work.maintainer.manage_any") ? await listWorkMaintainers(workId) : [];
  const relationCapabilities = getRelationEditorCapabilities(adminUser);
  return (
    <main>
      <PageHeader
        compact
        title={work.chineseTitle || work.originalTitle}
        actions={
          <BackLink href="/admin/works" label="返回游戏维护" />
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
            {canUpdateStatus ? <FormField label="状态">
              <SelectField
                aria-label="状态"
                defaultValue={work.status}
                name="status"
                options={[
                  { value: "published", label: "已发布" },
                  { value: "hidden", label: "隐藏" },
                  { value: "deleted", label: "已删除（仅后台可见）" },
                ]}
              />
            </FormField> : null}
            <CheckboxField defaultChecked={work.isTranslation} label="本站翻译" name="is_translation" />
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
          <div className="mb-4"><WorkStaffFields suggestions={creatorSuggestions} credits={work.creators.map((creator) => ({
            selection: { kind: "existing", creatorId: creator.id, name: creator.name, displayName: creator.displayName },
            roleKey: creator.roleKey as StaffCredit["roleKey"], roleLabel: creator.roleLabel, notes: creator.notes,
          }))} /></div>
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
        <Pane>
          <WorkMoreInfoFields items={work.moreInfo} />
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
          {hasPermission(adminUser, "archive_version.read_private") ? <Link
            className={buttonVariants({ variant: "outline" })}
            href="/admin/archive-versions"
          >
            查看归档历史
          </Link> : null}
        </StickySaveBar>
      </form>
      {hasPermission(adminUser, "work.maintainer.manage_any") ? <Pane heading="作品维护者">
        <ul className="grid gap-2">
          {maintainers.map((person) => <li key={person.id} className="flex items-center justify-between gap-3">
            <span>{person.name} · {person.email}</span>
            <ConfirmingForm action={`/api/admin/works/${workId}/maintainers`} confirmField="remove"
              title="移除维护者？" description="移除后，该用户将无法从“我的上传”维护这部作品。">
              <input name="email" type="hidden" value={person.email ?? ""} /><input name="remove" type="hidden" value="1" />
              <Button type="submit" size="sm" variant="outline">移除</Button>
            </ConfirmingForm>
          </li>)}
        </ul>
        <ConfirmingForm action={`/api/admin/works/${workId}/maintainers`} className="mt-4 flex items-end gap-3" confirmField="confirm"
          title="添加维护者" description="该账户将获得此作品的维护权限。">
          <FormField label="维护者邮箱" hint="账户需有“管理自己维护的作品”权限。"><Input name="email" type="email" required /></FormField>
          <Button type="submit">添加</Button>
        </ConfirmingForm>
      </Pane> : null}
      {canMergeWorks(adminUser) ? <Pane heading="合并重复作品" tone="danger">
        <ConfirmingForm action={`/api/admin/works/${workId}/merge`} confirmField="target_id" title="确认合并作品？"
          description="保留目标作品资料和下载入口，将归档、评论、收藏与关联转移至目标，当前作品设为已删除。此操作无法撤销；浏览器存档仍按原 Work ID 保存，不会自动转移。">
          <FormField label="目标作品 ID"><Input name="target_id" type="number" min={1} required /></FormField>
          <Button className="mt-3" type="submit" variant="destructive">合并到目标作品</Button>
        </ConfirmingForm>
      </Pane> : null}
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
