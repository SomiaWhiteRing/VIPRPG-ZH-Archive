import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { tagHref } from "@/lib/user-tags";
import { runtimeContext } from "@/app/.server/router-context";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getTagForAdminEdit } from "@/app/.server/db/taxonomy-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { StickySaveBar } from "@/app/admin/admin-list-controls";
import { BackLink } from "@/app/components/ui/back-link";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { RedirectForm } from "@/app/components/ui/redirect-form";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { Link } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const name = new URL(args.request.url).searchParams.get("name") ?? "";
  await requirePagePermission(
    runtime,
    `/admin/tags/edit?name=${encodeURIComponent(name)}`,
    "tag.metadata.update_any",
  );
  const tag = await getTagForAdminEdit(runtime, name);

  if (!tag) {
    throwNotFound();
  }

  return { tag };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: [loaderData?.tag.name || "标签", "公共标签维护", "控制台"] }, error);

export default function AdminTagEditPage() {
  const { tag } = useLoaderData<typeof loader>();
  return (
    <main key={tag.name}>
      <PageHeader
        compact
        title={tag.name}
        actions={
          <>
            <BackLink href="/admin/tags" label="返回公共标签维护" />
            {tag.workCount > 0 ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                to={tagHref(tag.name, "public")}
              >
                查看作品
              </Link>
            ) : null}
          </>
        }
      />

      <RedirectFeedback />

      <RedirectForm
        action="/api/admin/tags/update"
        className="grid gap-4"
        method="post"
      >
        <input name="original_name" type="hidden" value={tag.name} />
        <Pane heading="基础信息">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField controlId="admin-tags-edit--field-1" label="名称">
              <Input
                id="admin-tags-edit--field-1"
                defaultValue={tag.name}
                name="name"
                readOnly
              />
            </FormField>
            <FormField controlId="admin-tags-edit--field-2" label="命名空间">
              <SelectField
                id="admin-tags-edit--field-2"
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
            <FormField controlId="admin-tags-edit--field-3" label="描述" wide>
              <Textarea
                id="admin-tags-edit--field-3"
                defaultValue={tag.description ?? ""}
                name="description"
                rows={6}
              />
            </FormField>
          </div>
        </Pane>

        <StickySaveBar>
          <Button type="submit">保存标签资料</Button>
        </StickySaveBar>
      </RedirectForm>
    </main>
  );
}
