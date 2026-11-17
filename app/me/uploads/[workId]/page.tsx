import { parsePageId, throwNotFound } from "@/app/.server/http/page-response";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { getOwnedWorkForEdit } from "@/app/.server/db/game-library";
import { listPublicWorkMaintainers } from '@/app/.server/db/work-maintainers';
import { WorkMaintainerEditor } from '@/app/components/work/work-maintainer-editor';

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
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { type LoaderFunctionArgs, type MetaFunction, useLoaderData } from "react-router";
import type { PageLayoutHandle } from "@/app/components/use-page-layout";

export const handle = { layout: { accountLayout: "full-width" } } satisfies PageLayoutHandle;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params, searchParams } = routeInput(args);

  const workId = parsePageId((await params).workId);
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
    locale: runtime.uiLocale,
    suggestions,
    fromGameDetail,
    maintainers: await listPublicWorkMaintainers(runtime, workId),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [loaderData?.work.chineseTitle || loaderData?.work.originalTitle || translate(locale, "work.detail"), translate(locale, "upload.own.edit")] }, error, locale);
};

export default function UploadedWorkPage() {
  const t = useMessages();
  const { user, work, suggestions, fromGameDetail, maintainers } = useLoaderData<typeof loader>();
  return (
    <div key={`${user.id}:${work.id}`}>
      <PageHeader
        actions={
          <BackLink
            href={fromGameDetail ? `/games/${work.id}` : "/me/uploads"}
            label={t(fromGameDetail ? "upload.own.backWork" : "upload.own.backUploads")}
          />
        }
        title={t("upload.own.editNamed", { title: work.chineseTitle || work.originalTitle })}
      />
      {work.status === "processing" ? (
        <Notice tone="warning" className="mb-4">
          {t("upload.own.unfinished")}
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
        title={t("upload.own.deleteWorkConfirm")}
        description={t("upload.own.deleteWorkDescription")}
      >
        <input name="confirm" type="hidden" value="delete" />
        <Button type="submit" variant="destructive">
          {t("upload.own.deleteWork")}
        </Button>
      </ConfirmingForm>
    </div>
  );
}
