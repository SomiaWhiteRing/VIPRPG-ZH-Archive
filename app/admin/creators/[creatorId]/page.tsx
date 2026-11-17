import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";
import { parsePageId, throwNotFound } from "@/app/.server/http/page-response";
import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getCreatorForAdminEdit } from "@/app/.server/db/creator-library";

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
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { creatorRoleLabel, workStatusLabel } from "@/lib/labels";
import { type LoaderFunctionArgs, type MetaFunction, useLoaderData } from "react-router";

import { RedirectForm } from "@/app/components/ui/redirect-form";
import { useState } from "react";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

  const { creatorId: rawCreatorId } = await params;
  const creatorId = parsePageId(rawCreatorId);
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
    locale: runtime.uiLocale,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({
    title: [loaderData?.creator.name || translate(locale, "admin.creators.creator"), translate(locale, "admin.creators.manage"), translate(locale, "admin.characterIndex.console")],
  }, error, locale);
};

export default function AdminCreatorEditPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const navigationLocale = useNavigationLocale();
  const { adminUser, creator } = useLoaderData<typeof loader>();
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  return (
    <main key={creator.id}>
      <PageHeader
        compact
        title={creator.name}
        actions={
          <>
            <BackLink href="/admin/creators" label={t("admin.creators.back")} />
            <Link
              className={buttonVariants({ variant: "outline" })}
              to={`/creators/${creator.id}`}
            >
              {t("admin.creators.publicPage")}
            </Link>
          </>
        }
      />

      <RedirectForm
        action={`/api/admin/creators/${creator.id}/update`}
        className="grid gap-4"
        method="post"
        encType="multipart/form-data"
        onBusyChange={setBusy}
        preserveLanguage
      >
        <input name="creator_id" type="hidden" value={creator.id} />

        <Pane heading={t("creator.edit.avatar")}>
          <AvatarCropper
            allowDelete
            avatarBlobSha256={creator.avatarBlobSha256}
            displayName={creator.name}
            disabled={busy}
            onBusyChange={setAvatarBusy}
            shape="square"
          />
        </Pane>

        <Pane heading={t("creator.edit.basic")}>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              controlId="admin-creators-creatorId--field-1"
              label={t("creator.name")}
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
              hint={t("admin.creators.aliasHint")}
              label={t("admin.creators.aliases")}
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
              label={t("admin.creators.bio")}
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
          <Button type="submit" disabled={busy || avatarBusy}>{t("admin.creators.save")}</Button>
        </StickySaveBar>
      </RedirectForm>
      {hasPermission(adminUser, "creator.merge_any") ? (
        <Pane heading={t("admin.creators.merge")} tone="danger">
          <ConfirmingForm
            action={`/api/admin/creators/${creator.id}/merge${navigationLocale ? `?${UI_LOCALE_PARAM}=${navigationLocale}` : ""}`}
            confirmField="target_id"
            title={t("admin.creators.confirm")}
            description={t("admin.creators.mergeDetail")}
          >
            <FormField
              controlId="admin-creators-creatorId--field-5"
              label={t("admin.creators.target")}
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
              {t("admin.creators.mergeSubmit")}
            </Button>
          </ConfirmingForm>
        </Pane>
      ) : null}

      <section
        className="grid gap-3 md:grid-cols-3 grid gap-4 lg:grid-cols-2"
        aria-label={t("admin.creators.associations")}
      >
        <Pane heading={t("admin.creators.roles")}>
          {creator.adminWorkCredits.length > 0 ? (
            <ul className="mt-3 grid gap-3">
              {creator.adminWorkCredits.map((credit) => (
                <li key={`${credit.workId}-${credit.roleKey}`}>
                  <Link to={`/admin/works/${credit.workId}`}>
                    {credit.workTitle}
                  </Link>
                  <span className="text-sm text-muted">
                    {creatorRoleLabel(credit.roleKey, locale)} /{" "}
                    {workStatusLabel(credit.status, locale)}
                    {credit.notes ? ` / ${credit.notes}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("admin.creators.noRoles")} />
          )}
        </Pane>
      </section>
    </main>
  );
}
