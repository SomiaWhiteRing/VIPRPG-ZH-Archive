import { requireAccountUser } from "@/app/.server/auth/account-user";
import { pickPageFields } from "@/app/.server/page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { loadUploadSuggestions } from "@/app/.server/upload-suggestions";
import { buttonVariants } from "@/app/components/ui/button";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { UploadClient } from "@/app/upload/upload-client";
import { canPublishWork } from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const currentUser = await requireAccountUser(runtime, "/upload");

  const suggestions = canPublishWork(currentUser)
    ? await loadUploadSuggestions(runtime)
    : null;

  return {
    currentUser: pickPageFields(currentUser, [
      "id",
      "displayName",
      "permissionKeys",
    ]),
    suggestions,
    locale: runtime.uiLocale,
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "upload.title") }, error, locale);
};

export default function UploadPage() {
  const t = useMessages();
  const { currentUser, suggestions } = useLoaderData<typeof loader>();
  if (!suggestions) {
    return (
      <PageContainer className="space-y-5">
        <PageHeader compact title={t("upload.permission")} />

        <Pane>
          <p>{t("upload.permissionHelp")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Link className={buttonVariants()} to="/me/permissions?role=uploader">
              {t("upload.account")}
            </Link>
          </div>
        </Pane>
      </PageContainer>
    );
  }
  return (
    <PageContainer className="space-y-5">
      <PageHeader compact title={t("upload.title")} />
      <UploadClient
        currentUser={{
          id: currentUser.id,
          displayName: currentUser.displayName,
          permissionKeys: currentUser.permissionKeys,
        }}
        suggestions={suggestions}
      />
    </PageContainer>
  );
}
