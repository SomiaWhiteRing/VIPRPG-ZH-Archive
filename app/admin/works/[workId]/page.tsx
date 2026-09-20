import { requirePagePermission } from "@/app/.server/auth/authorize";
import { listWorkMaintainers } from "@/app/.server/db/catalog-maintenance";
import { listCreatorSuggestions } from "@/app/.server/db/creator-library";
import { getWorkForAdminEdit } from "@/app/.server/db/game-library";
import { listCharacterSuggestions } from "@/app/.server/db/taxonomy-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { StickySaveBar } from "@/app/admin/admin-list-controls";
import { BackLink } from "@/app/components/ui/back-link";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { CheckboxField } from "@/app/components/ui/checkbox-field";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { AdminLanguageField } from "@/app/components/work/language-field";
import { WorkMoreInfoFields } from "@/app/components/work/work-more-info-editor";
import { RelationEditor } from "@/app/games/[id]/relation-editor";
import {
  canMergeWorks,
  getRelationEditorCapabilities,
  hasPermission,
} from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { StaffCredit } from "@/lib/staff-credits";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { StructuredWorkFields } from "../structured-work-fields";
import { WorkStaffFields } from "../work-staff-fields";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const workId = parseId((await params).workId);
  const adminUser = await requirePagePermission(
    runtime,
    `/admin/works/${workId}`,
    "work.metadata.update_any",
  );
  const [work, characterSuggestions, creatorSuggestions] = await Promise.all([
    getWorkForAdminEdit(runtime, workId),
    listCharacterSuggestions(runtime),
    listCreatorSuggestions(runtime),
  ]);
  if (!work) throwNotFound();
  const canUpdateStatus = hasPermission(adminUser, "work.status.update_any");
  if (work.status === "deleted" && !canUpdateStatus) throwNotFound();
  const maintainers = hasPermission(adminUser, "work.maintainer.manage_any")
    ? await listWorkMaintainers(runtime, workId)
    : [];
  const relationCapabilities = getRelationEditorCapabilities(adminUser);

  return {
    workId,
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    work,
    characterSuggestions,
    creatorSuggestions,
    canUpdateStatus,
    maintainers,
    relationCapabilities,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    {
      title: [
        loaderData?.work.chineseTitle || loaderData?.work.originalTitle || "作品",
        "作品维护",
        "控制台",
      ],
    },
    error,
  );

export default function AdminWorkEditPage() {
  const {
    workId,
    adminUser,
    work,
    characterSuggestions,
    creatorSuggestions,
    canUpdateStatus,
    maintainers,
    relationCapabilities,
  } = useLoaderData<typeof loader>();
  return (
    <main key={work.id}>
      <PageHeader
        compact
        title={work.chineseTitle || work.originalTitle}
        actions={<BackLink href="/admin/works" label="返回游戏维护" />}
      />
      <form
        action={`/api/admin/works/${work.id}/update`}
        className="grid gap-4"
        method="post"
      >
        <input name="work_id" type="hidden" value={work.id} />
        <Pane heading="游戏资料">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              controlId="admin-works-workId--field-1"
              hint="不可修改"
              label="原名"
            >
              <Input
                aria-describedby="admin-works-workId--field-1-hint"
                id="admin-works-workId--field-1"
                readOnly
                value={work.originalTitle}
              />
            </FormField>
            <FormField controlId="admin-works-workId--field-2" label="中文名">
              <Input
                id="admin-works-workId--field-2"
                defaultValue={work.chineseTitle ?? ""}
                name="chinese_title"
              />
            </FormField>
            <FormField
              controlId="admin-works-workId--field-3"
              label="原作发布日期"
            >
              <Input
                id="admin-works-workId--field-3"
                defaultValue={work.originalReleaseDate ?? ""}
                name="original_release_date"
                placeholder="YYYY-MM-DD / YYYY-MM / YYYY"
              />
            </FormField>
            <AdminLanguageField value={work.language} />
            <CheckboxField
              defaultChecked={work.isOriginal}
              label="本站原创"
              name="is_original"
            />
            <FormField controlId="admin-works-workId--field-5" label="引擎">
              <SelectField
                id="admin-works-workId--field-5"
                aria-label="引擎"
                defaultValue={work.engineFamily}
                name="engine_family"
                options={[
                  { value: "rpg_maker_2000", label: "RPG Maker 2000" },
                  { value: "rpg_maker_2003", label: "RPG Maker 2003" },
                  {
                    value: "rpg_maker_2003_maniac",
                    label: "RPG Maker 2003 Maniac",
                  },
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
            {canUpdateStatus ? (
              <FormField controlId="admin-works-workId--field-6" label="状态">
                <SelectField
                  id="admin-works-workId--field-6"
                  aria-label="状态"
                  defaultValue={work.status}
                  name="status"
                  options={[
                    { value: "published", label: "已发布" },
                    { value: "hidden", label: "隐藏" },
                    { value: "deleted", label: "已删除（仅后台可见）" },
                  ]}
                />
              </FormField>
            ) : null}
            <CheckboxField
              defaultChecked={work.isTranslation}
              label="本站翻译"
              name="is_translation"
            />
            <CheckboxField
              defaultChecked={work.usesUnsupportedManiac}
              label="本作品使用了EasyRPG不支持的Maniac语法。"
              name="uses_unsupported_maniac"
            />
            <FormField
              controlId="admin-works-workId--field-7"
              label="简介"
              wide
            >
              <Textarea
                id="admin-works-workId--field-7"
                defaultValue={work.description ?? ""}
                name="description"
                rows={6}
              />
            </FormField>
          </div>
        </Pane>
        <Pane heading="作者、标签与资料">
          <div className="mb-4">
            <WorkStaffFields
              suggestions={creatorSuggestions}
              credits={work.creators.map((creator) => ({
                selection: {
                  kind: "existing",
                  creatorId: creator.id,
                  name: creator.name,
                  displayName: creator.displayName,
                },
                roleKey: creator.roleKey as StaffCredit["roleKey"],
                roleLabel: creator.roleLabel,
                notes: creator.notes,
              }))}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              controlId="admin-works-workId--field-8"
              hint="每行一个别名。"
              label="别名"
            >
              <Textarea
                aria-describedby="admin-works-workId--field-8-hint"
                id="admin-works-workId--field-8"
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
                coverBlobSha256={work.media.find((media) => media.role === "cover")?.blobSha256 ?? ""}
                previewBlobSha256s={work.media
                  .filter((media) => media.role === "preview")
                  .map((media) => media.blobSha256)}
                tags={work.tags}
              />
            </div>
          </div>
        </Pane>
        <Pane>
          <WorkMoreInfoFields items={work.moreInfo} />
        </Pane>
        {!work.hasUsableDistribution ? <p className="text-sm text-muted">缺少可用下载来源，作品当前不会公开展示。恢复来源后按原发布状态展示。</p> : null}
        <StickySaveBar>
          <Button type="submit">保存游戏资料</Button>
          {work.status === "published" && work.hasUsableDistribution ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to={`/games/${work.id}`}
            >
              查看公开页
            </Link>
          ) : null}
          {hasPermission(adminUser, "archive_version.read_private") ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/archive-versions"
            >
              查看归档历史
            </Link>
          ) : null}
        </StickySaveBar>
      </form>
      {hasPermission(adminUser, "work.maintainer.manage_any") ? (
        <Pane heading="作品维护者">
          <ul className="grid gap-2">
            {maintainers.map((person) => (
              <li
                key={person.id}
                className="flex items-center justify-between gap-3"
              >
                <span>
                  {person.name} · {person.email}
                </span>
                <ConfirmingForm
                  action={`/api/admin/works/${workId}/maintainers`}
                  confirmField="remove"
                  title="移除维护者？"
                  description="移除后，该用户将无法从“我的上传”维护这部作品。"
                >
                  <input
                    name="email"
                    type="hidden"
                    value={person.email ?? ""}
                  />
                  <input name="remove" type="hidden" value="1" />
                  <Button type="submit" size="sm" variant="outline">
                    移除
                  </Button>
                </ConfirmingForm>
              </li>
            ))}
          </ul>
          <ConfirmingForm
            action={`/api/admin/works/${workId}/maintainers`}
            className="mt-4 flex items-end gap-3"
            confirmField="confirm"
            title="添加维护者"
            description="该账户将获得此作品的维护权限。"
          >
            <FormField
              controlId="admin-works-workId--field-9"
              label="维护者邮箱"
              hint="账户需有“管理自己维护的作品”权限。"
            >
              <Input
                aria-describedby="admin-works-workId--field-9-hint"
                id="admin-works-workId--field-9"
                name="email"
                type="email"
                required
              />
            </FormField>
            <Button type="submit">添加</Button>
          </ConfirmingForm>
        </Pane>
      ) : null}
      {canMergeWorks(adminUser) ? (
        <Pane heading="合并重复作品" tone="danger">
          <ConfirmingForm
            action={`/api/admin/works/${workId}/merge`}
            confirmField="target_id"
            title="确认合并作品？"
            description="保留目标作品资料和下载入口，将归档、评论、收藏与关联转移至目标，当前作品设为已删除。此操作无法撤销；浏览器存档仍按原 Work ID 保存，不会自动转移。"
          >
            <FormField
              controlId="admin-works-workId--field-10"
              label="目标作品 ID"
            >
              <Input
                id="admin-works-workId--field-10"
                name="target_id"
                type="number"
                min={1}
                required
              />
            </FormField>
            <Button className="mt-3" type="submit" variant="destructive">
              合并到目标作品
            </Button>
          </ConfirmingForm>
        </Pane>
      ) : null}
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
  if (!Number.isSafeInteger(id) || id <= 0) throwNotFound();
  return id;
}
