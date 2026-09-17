import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { requirePagePermission } from "@/app/.server/auth/authorize";
import {
  getTagForAdminEdit,
  listTagsForAdmin,
} from "@/app/.server/db/taxonomy-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { StickySaveBar } from "@/app/admin/admin-list-controls";
import { BackLink } from "@/app/components/ui/back-link";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Notice } from "@/app/components/ui/notice";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { Link } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);

  const { tagId: rawTagId } = await params;
  const query = await searchParams;
  const formError = Array.isArray(query.error) ? query.error[0] : query.error;
  const tagId = parseId(rawTagId);
  await requirePagePermission(
    runtime,
    `/admin/tags/${tagId}`,
    "tag.metadata.update_any",
  );
  const [tag, candidates] = await Promise.all([
    getTagForAdminEdit(runtime, tagId),
    listTagsForAdmin(runtime),
  ]);

  if (!tag) {
    throwNotFound();
  }

  return { formError, tag, candidates };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: [loaderData?.tag.name || "标签", "标签维护", "控制台"] }, error);

export default function AdminTagEditPage() {
  const { formError, tag, candidates } = useLoaderData<typeof loader>();
  return (
    <main key={tag.id}>
      <PageHeader
        compact
        title={tag.name}
        actions={
          <>
            <BackLink href="/admin/tags" label="返回标签维护" />
            {tag.workCount > 0 ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                to={`/games?tag=${tag.id}`}
              >
                查看作品
              </Link>
            ) : null}
          </>
        }
      />

      {formError ? (
        <Notice tone="error" className="mb-4 border p-3 text-sm" role="alert">
          {formError}
        </Notice>
      ) : null}

      <ConfirmingForm
        action={`/api/admin/tags/${tag.id}/update`}
        className="grid gap-4 grid gap-4"
        confirmField="merge_target_id"
        errorTitle="标签资料保存失败"
        method="post"
        title="确认合并并删除标签"
        description="目标标签会接收现有关联，当前标签将被删除。此操作不可逆，请确认目标名称正确。"
      >
        <input name="tag_id" type="hidden" value={tag.id} />
        <Pane heading="基础信息">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField controlId="admin-tags-tagId--field-1" label="名称">
              <Input
                id="admin-tags-tagId--field-1"
                defaultValue={tag.name}
                name="name"
                required
              />
            </FormField>
            <FormField controlId="admin-tags-tagId--field-2" label="命名空间">
              <SelectField
                id="admin-tags-tagId--field-2"
                aria-label="命名空间"
                defaultValue={tag.namespace}
                name="namespace"
                options={[
                  { value: "genre", label: "类型" },
                  { value: "theme", label: "主题" },
                  { value: "character", label: "角色相关" },
                  { value: "technical", label: "技术" },
                  { value: "content", label: "内容" },
                  { value: "other", label: "其他" },
                ]}
              />
            </FormField>
            <FormField controlId="admin-tags-tagId--field-3" label="描述" wide>
              <Textarea
                id="admin-tags-tagId--field-3"
                defaultValue={tag.description ?? ""}
                name="description"
                rows={6}
              />
            </FormField>
          </div>
        </Pane>

        <Pane heading="合并重复标签" tone="danger">
          <FormField
            controlId="admin-tags-tagId--field-4"
            hint="提交后，游戏关联会移至目标标签，当前标签会被删除。"
            hintId="tag-merge-target-hint"
            label="目标标签"
          >
            <SelectField
              id="admin-tags-tagId--field-4"
              aria-describedby="tag-merge-target-hint"
              aria-label="目标标签"
              name="merge_target_id"
              options={[
                { value: "", label: "不合并" },
                ...candidates
                  .filter((candidate) => candidate.id !== tag.id)
                  .map((candidate) => ({
                    value: String(candidate.id),
                    label: candidate.name,
                  })),
              ]}
            />
          </FormField>
        </Pane>

        <StickySaveBar>
          <Button type="submit">保存标签资料</Button>
        </StickySaveBar>
      </ConfirmingForm>
    </main>
  );
}

function parseId(value: string): number {
  const id = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throwNotFound();
  }

  return id;
}
