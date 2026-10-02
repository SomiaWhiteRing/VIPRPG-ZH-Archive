import { WorkEditForm } from "../work-edit-form";
import { loadUploadSuggestions } from "@/app/.server/upload-suggestions";
import { getWorkRelationEditorCapabilities } from "@/app/.server/db/relations";
import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { listPublicWorkMaintainers } from "@/app/.server/db/work-maintainers";
import { WorkMaintainerEditor } from "@/app/components/work/work-maintainer-editor";
import { getWorkForAdminEdit } from "@/app/.server/db/game-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { StickySaveBar } from "@/app/admin/admin-list-controls";
import { BackLink } from "@/app/components/ui/back-link";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { RelationEditor } from "@/app/games/[id]/relation-editor";
import {
  canMergeWorks,
  hasPermission,
} from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const workId = parseId((await params).workId);
  const adminUser = await requireAnyPagePermission(
    runtime,
    `/admin/works/${workId}`,
    ["work.metadata.update_any", "work.distribution.update_any"],
  );
  const [work, suggestions] = await Promise.all([
    getWorkForAdminEdit(runtime, workId),
    loadUploadSuggestions(runtime),
  ]);
  if (!work) throwNotFound();
  const canUpdateStatus = hasPermission(adminUser, "work.status.update_any");
  if (work.status === "deleted" && !canUpdateStatus) throwNotFound();
  const maintainers = hasPermission(adminUser, "work.maintainer.manage_any")
    ? await listPublicWorkMaintainers(runtime, workId)
    : [];
  const relationCapabilities = await getWorkRelationEditorCapabilities(runtime, workId, adminUser);

  return {
    workId,
    adminUser: pickPageFields(adminUser, ["id", "displayName", "status", "permissionKeys"]),
    work,
    suggestions,
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
    suggestions,
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
      <WorkEditForm work={work} currentUser={adminUser} suggestions={suggestions} canUpdateStatus={canUpdateStatus}>
        {!work.hasUsableDistribution ? <p className="text-sm text-muted">缺少可用下载来源。已发布的作品资料仍公开展示，恢复来源后可重新下载。</p> : null}
        <StickySaveBar>
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
      </WorkEditForm>
      {hasPermission(adminUser, "work.maintainer.manage_any") ? (
        <WorkMaintainerEditor workId={workId} initialMaintainers={maintainers} canRemove />
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
