import { requireAccountUser } from "@/app/.server/auth/account-user";
import { getOwnedWorkForEdit } from "@/app/.server/db/game-library";
import { listPublicWorkMaintainers } from '@/app/.server/db/work-maintainers';
import { WorkMaintainerEditor } from '@/app/components/work/work-maintainer-editor';
import { throwNotFound } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { loadUploadSuggestions } from "@/app/.server/upload-suggestions";
import { BackLink } from "@/app/components/ui/back-link";
import { Button } from "@/app/components/ui/button";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { Notice } from "@/app/components/ui/notice";
import { PageHeader } from "@/app/components/ui/page-header";
import { uploadInitialWork } from "@/app/upload/initial-work";
import { UploadClient } from "@/app/upload/upload-client";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);

  const workId = parseId((await params).workId);
  const fromGameDetail = (await searchParams).from === "game";
  const user = await requireAccountUser(
    runtime,
    `/me/uploads/${workId}${fromGameDetail ? "?from=game" : ""}`,
  );
  if (!hasPermission(user, "work.update_own")) throwNotFound();
  const work = await getOwnedWorkForEdit(runtime, workId, user);
  if (!work) throwNotFound();
  const suggestions = await loadUploadSuggestions(runtime);

  return {
    user: pickPageFields(user, ["id", "displayName", "status", "permissionKeys"]),
    work,
    suggestions,
    fromGameDetail,
    maintainers: await listPublicWorkMaintainers(runtime, workId),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    {
      title: [
        loaderData?.work.chineseTitle || loaderData?.work.originalTitle || "作品",
        "编辑作品",
      ],
    },
    error,
  );

export default function UploadedWorkPage() {
  const { user, work, suggestions, fromGameDetail, maintainers } = useLoaderData<typeof loader>();
  return (
    <div key={`${user.id}:${work.id}`}>
      <PageHeader
        actions={
          <BackLink
            href={fromGameDetail ? `/games/${work.id}` : "/me/uploads"}
            label={fromGameDetail ? "返回作品详情" : "返回我的上传"}
          />
        }
        title={`编辑作品：${work.chineseTitle || work.originalTitle}`}
      />
      {work.status === "processing" ? (
        <Notice tone="warning" className="mb-4">
          这条上传尚未完成。上传失败后，可以重新选择游戏文件并保存资料，也可以删除这条记录；仍在提交时请等待上传结束。
        </Notice>
      ) : null}
      <UploadClient
        saveRedirectTo={fromGameDetail ? `/games/${work.id}` : "/me/uploads"}
        currentUser={{
          id: user.id,
          displayName: user.displayName,
          permissionKeys: user.permissionKeys,
        }}
        initialWork={uploadInitialWork(work)}
        suggestions={suggestions}
      />
      <WorkMaintainerEditor workId={work.id} initialMaintainers={maintainers} canRemove={hasPermission(user, 'work.maintainer.manage_any')} />
      <ConfirmingForm
        action={`/api/works/${work.id}/delete`}
        className="mt-8"
        confirmField="confirm"
        title="确认删除作品？"
        description="删除后，作品将从公开页面和“我的上传”中移除，你将无法查看或修改。文件和资料会保留，只有管理员可以恢复。"
      >
        <input name="confirm" type="hidden" value="delete" />
        <Button type="submit" variant="destructive">
          删除作品
        </Button>
      </ConfirmingForm>
    </div>
  );
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(id) || id <= 0) throwNotFound();
  return id;
}
