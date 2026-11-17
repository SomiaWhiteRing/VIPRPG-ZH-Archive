import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
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

  return { tag, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  const title = translate(locale, "admin.tags.title");
  const consoleTitle = translate(locale, "admin.characterIndex.console");
  return pageMetaDescriptors({ title: loaderData?.tag.name ? [loaderData.tag.name, title, consoleTitle] : [title, consoleTitle] }, error, locale);
};

export default function AdminTagEditPage() {
  const t = useMessages();
  const { tag } = useLoaderData<typeof loader>();
  return (
    <main key={tag.name}>
      <PageHeader
        compact
        title={tag.name}
        actions={
          <>
            <BackLink href="/admin/tags" label={t("admin.tags.back")} />
            {tag.workCount > 0 ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                to={tagHref(tag.name, "public")}
              >
                {t("admin.tags.works")}
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
        preserveLanguage
      >
        <input name="original_name" type="hidden" value={tag.name} />
        <Pane heading={t("creator.edit.basic")}>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField controlId="admin-tags-edit--field-1" label={t("creator.name")}>
              <Input
                id="admin-tags-edit--field-1"
                defaultValue={tag.name}
                name="name"
                readOnly
              />
            </FormField>
            <FormField controlId="admin-tags-edit--field-2" label={t("admin.tags.namespace")}>
              <SelectField
                id="admin-tags-edit--field-2"
                aria-label={t("admin.tags.namespace")}
                defaultValue={tag.namespace}
                name="namespace"
                options={[
                  { value: "genre", label: t("admin.tags.genre") },
                  { value: "theme", label: t("admin.tags.theme") },
                  { value: "character", label: t("admin.tags.character") },
                  { value: "technical", label: t("admin.tags.technical") },
                  { value: "content", label: t("admin.tags.content") },
                  { value: "other", label: t("admin.tags.other") },
                ]}
              />
            </FormField>
            <FormField controlId="admin-tags-edit--field-3" label={t("admin.tags.description")} wide>
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
          <Button type="submit">{t("admin.tags.save")}</Button>
        </StickySaveBar>
      </RedirectForm>
    </main>
  );
}
