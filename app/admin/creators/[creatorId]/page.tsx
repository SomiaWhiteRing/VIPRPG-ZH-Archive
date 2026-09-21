import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getCreatorForAdminEdit } from "@/app/.server/db/creator-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { StickySaveBar } from "@/app/admin/admin-list-controls";
import { CreatorLinksEditor } from "@/app/components/creators/creator-links-editor";
import { AvatarCropper } from "@/app/components/ui/avatar-cropper";
import { BackLink } from "@/app/components/ui/back-link";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { ConfirmingForm } from "@/app/components/ui/confirming-form";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { Textarea } from "@/app/components/ui/textarea";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { creatorRoleLabel, workStatusLabel } from "@/lib/labels";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const { creatorId: rawCreatorId } = await params;
  const creatorId = parseCreatorId(rawCreatorId);
  const adminUser = await requirePagePermission(
    runtime,
    `/admin/creators/${creatorId}`,
    "creator.metadata.update_any",
  );
  const creator = await getCreatorForAdminEdit(runtime, creatorId);

  if (!creator) {
    throwNotFound();
  }

  return {
    adminUser: pickPageFields(adminUser, ["id", "status", "permissionKeys"]),
    creator,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    {
      title: [loaderData?.creator.name || "作者", "作者维护", "控制台"],
    },
    error,
  );

export default function AdminCreatorEditPage() {
  const { adminUser, creator } = useLoaderData<typeof loader>();
  return (
    <main key={creator.id}>
      <PageHeader
        compact
        title={creator.name}
        actions={
          <>
            <BackLink href="/admin/creators" label="返回作者维护" />
            <Link
              className={buttonVariants({ variant: "outline" })}
              to={`/creators/${creator.id}`}
            >
              查看公开页
            </Link>
          </>
        }
      />

      <Pane heading="头像">
        <AvatarCropper
          allowDelete
          avatarBlobSha256={creator.avatarBlobSha256}
          displayName={creator.name}
          endpoint={`/api/admin/creators/${creator.id}/avatar`}
          shape="square"
        />
      </Pane>

      <form
        action={`/api/admin/creators/${creator.id}/update`}
        className="grid gap-4"
        method="post"
      >
        <input name="creator_id" type="hidden" value={creator.id} />

        <Pane heading="基础信息">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              controlId="admin-creators-creatorId--field-1"
              label="名称"
            >
              <Input
                id="admin-creators-creatorId--field-1"
                defaultValue={creator.name}
                name="name"
                required
                type="text"
              />
            </FormField>
            <FormField
              controlId="admin-creators-creatorId--field-2"
              hint="每行一个；规范名称不必重复填写。"
              label="别名"
              wide
            >
              <Textarea
                aria-describedby="admin-creators-creatorId--field-2-hint"
                id="admin-creators-creatorId--field-2"
                defaultValue={creator.aliases.join("\n")}
                name="aliases"
                rows={5}
              />
            </FormField>
            <div className="md:col-span-2">
              <CreatorLinksEditor initialLinks={creator.links} />
            </div>
            <FormField
              controlId="admin-creators-creatorId--field-4"
              label="简介"
              wide
            >
              <Textarea
                id="admin-creators-creatorId--field-4"
                defaultValue={creator.bio ?? ""}
                name="bio"
                rows={6}
              />
            </FormField>
          </div>
        </Pane>

        <StickySaveBar>
          <Button type="submit">保存作者资料</Button>
        </StickySaveBar>
      </form>
      {hasPermission(adminUser, "creator.merge_any") ? (
        <Pane heading="合并重复人物" tone="danger">
          <ConfirmingForm
            action={`/api/admin/creators/${creator.id}/merge`}
            confirmField="target_id"
            title="确认合并人物？"
            description="保留目标人物资料，将署名、别名和评论转移至目标，删除当前人物条目。此操作无法撤销。"
          >
            <FormField
              controlId="admin-creators-creatorId--field-5"
              label="目标人物 ID"
            >
              <Input
                id="admin-creators-creatorId--field-5"
                name="target_id"
                type="number"
                min={1}
                required
              />
            </FormField>
            <Button className="mt-3" type="submit" variant="destructive">
              合并到目标人物
            </Button>
          </ConfirmingForm>
        </Pane>
      ) : null}

      <section
        className="grid gap-3 md:grid-cols-3 grid gap-4 lg:grid-cols-2"
        aria-label="作者关联"
      >
        <Pane heading="作品层职务">
          {creator.adminWorkCredits.length > 0 ? (
            <ul className="mt-3 grid gap-3">
              {creator.adminWorkCredits.map((credit) => (
                <li key={`${credit.workId}-${credit.roleKey}`}>
                  <Link to={`/admin/works/${credit.workId}`}>
                    {credit.workTitle}
                  </Link>
                  <span className="text-sm text-muted">
                    {creatorRoleLabel(credit.roleKey)} /{" "}
                    {workStatusLabel(credit.status)}
                    {credit.notes ? ` / ${credit.notes}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="暂无作品层职务。" />
          )}
        </Pane>
      </section>
    </main>
  );
}

function parseCreatorId(value: string): number {
  const creatorId = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(creatorId) || creatorId <= 0) {
    throwNotFound();
  }

  return creatorId;
}
