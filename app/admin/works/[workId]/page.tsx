import { parsePageId, throwNotFound } from "@/app/.server/http/page-response";
import { WorkEditForm } from "../work-edit-form";
import { loadUploadSuggestions } from "@/app/.server/upload-suggestions";
import { getWorkRelationEditorCapabilities } from "@/app/.server/db/relations";
import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { listPublicWorkMaintainers } from "@/app/.server/db/work-maintainers";
import { WorkMaintainerEditor } from "@/app/components/work/work-maintainer-editor";
import { getWorkForAdminEdit } from "@/app/.server/db/game-library";
import { getWorkNetplaySpaceId, listNetplaySpaces } from "@/app/.server/db/netplay-spaces";

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
import { RedirectForm } from "@/app/components/ui/redirect-form";
import { SelectField } from "@/app/components/ui/select";
import { RelationEditor } from "@/app/games/[id]/relation-editor";
import {
  canMergeWorks,
  hasPermission,
} from "@/lib/authz/permissions";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { type LoaderFunctionArgs, type MetaFunction, useLoaderData } from "react-router";


export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const workId = parsePageId((await params).workId);
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
  const netplay = hasPermission(adminUser, "work.distribution.update_any") && work.status !== "deleted"
    ? { spaceId: await getWorkNetplaySpaceId(runtime, workId), spaces: (await listNetplaySpaces(runtime)).map(({ id, name }) => ({ id, name })) }
    : null;

  return {
    workId,
    adminUser: pickPageFields(adminUser, ["id", "displayName", "status", "permissionKeys"]),
    work,
    suggestions,
    canUpdateStatus,
    maintainers,
    relationCapabilities,
    netplay,
    locale: runtime.uiLocale,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [loaderData?.work.chineseTitle || loaderData?.work.originalTitle || translate(locale, "admin.works.game"), translate(locale, "admin.works.detail"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};

export default function AdminWorkEditPage() {
  const t = useMessages();
  const {
    workId,
    adminUser,
    work,
    suggestions,
    canUpdateStatus,
    maintainers,
    relationCapabilities,
    netplay,
  } = useLoaderData<typeof loader>();
  const netplayFormId = "work-netplay-space-form";
  return (
    <main key={work.id}>
      <PageHeader
        compact
        title={work.chineseTitle || work.originalTitle}
        actions={<BackLink href="/admin/works" label={t("admin.works.back")} />}
      />
      {netplay ? <RedirectForm id={netplayFormId} action={`/api/admin/works/${workId}/netplay-space`} preserveLanguage /> : null}
      <WorkEditForm
        work={work}
        currentUser={adminUser}
        suggestions={suggestions}
        canUpdateStatus={canUpdateStatus}
        netplaySpace={netplay ? (
          <fieldset className="rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-semibold">{t("admin.works.space")}</legend>
            <div className="flex flex-wrap items-end gap-3">
              <SelectField name="space_id" form={netplayFormId} aria-label={t("admin.works.space")}
                defaultValue={netplay.spaceId === null ? "none" : String(netplay.spaceId)}
                options={[{ value: "none", label: t("admin.works.noSpace") }, ...netplay.spaces.map((space) => ({ value: String(space.id), label: space.name }))]} />
              <Button type="submit" form={netplayFormId}>{t("admin.works.saveSpace")}</Button>
              {hasPermission(adminUser, "system.maintenance.run") ? (
                <Link to="/admin/netplay-spaces" className={buttonVariants({ variant: "outline" })}>{t("admin.works.manageSpace")}</Link>
              ) : null}
            </div>
          </fieldset>
        ) : null}
      >
        {!work.hasUsableDistribution ? <p className="text-sm text-muted">{t("admin.works.noDistribution")}</p> : null}
        <StickySaveBar>
          {work.status === "published" && work.hasUsableDistribution ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to={`/games/${work.id}`}
            >
              {t("admin.works.view")}
            </Link>
          ) : null}
          {hasPermission(adminUser, "archive_version.read_private") ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/admin/archive-versions"
            >
              {t("admin.works.archives")}
            </Link>
          ) : null}
        </StickySaveBar>
      </WorkEditForm>
      {canUpdateStatus ? (
        <Pane heading={t("admin.works.management")}>
          <ConfirmingForm action={`/api/admin/works/${workId}/lifecycle`} confirmField="operation"
            title={work.status === "deleted" ? t("admin.works.restoreConfirm") : t("upload.own.deleteWorkConfirm")}
            description={work.status === "deleted" ? t("admin.works.restoreDescription") : t("admin.works.deleteDescription")}>
            <input type="hidden" name="operation" value={work.status === "deleted" ? "restore" : "delete"} />
            <input type="hidden" name="expected_status" value={work.status} />
            <Button type="submit" variant={work.status === "deleted" ? "outline" : "destructive"}>
              {work.status === "deleted" ? t("admin.works.restore") : t("upload.own.deleteWork")}
            </Button>
          </ConfirmingForm>
        </Pane>
      ) : null}
      {hasPermission(adminUser, "work.maintainer.manage_any") ? (
        <WorkMaintainerEditor workId={workId} initialMaintainers={maintainers} canRemove />
      ) : null}
      {canMergeWorks(adminUser) ? (
        <Pane heading={t("admin.works.merge")} tone="danger">
          <ConfirmingForm
            action={`/api/admin/works/${workId}/merge`}
            confirmField="target_id"
            title={t("admin.works.mergeConfirm")}
            description={t("admin.works.mergeDescription")}
          >
            <FormField
              controlId="admin-works-workId--field-10"
              label={t("admin.works.targetId")}
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
              {t("admin.works.mergeSubmit")}
            </Button>
          </ConfirmingForm>
        </Pane>
      ) : null}
      <Pane heading={t("admin.works.relations")}>
        <p className="text-sm text-muted">
          {t("admin.works.relationHelp")}
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
