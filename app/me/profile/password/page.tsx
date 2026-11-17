import { useMessages } from "@/lib/i18n/react";
import { translate } from "@/lib/i18n/core";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { PasswordInput } from "@/app/components/auth/auth-input";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import { requireAccountUser } from "@/app/.server/auth/account-user";
import { AccountField } from "@/app/components/profile/account-field";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { RedirectForm } from "@/app/components/ui/redirect-form";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  await requireAccountUser(runtime, "/me/profile/password");
  const params = await searchParams;

  return { locale: runtime.uiLocale, params };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "profile.changePassword"), translate(locale, "header.me")] }, error, locale);
};

export default function PasswordPage() {
  const t = useMessages();
  return (
    <div>
      <AccountPageHeader parentTitle={t("account.nav.profile")} title={t("profile.changePassword")} />
      <RedirectFeedback success={{ passwordUpdated: t("profile.passwordUpdated") }} />

      <RedirectForm action="/api/account/password" preserveLanguage className="grid gap-4" method="post">
        <AccountField htmlFor="password-current" label={t("profile.currentPassword")}>
          <PasswordInput
            id="password-current"
            name="currentPassword"
            required
          />
        </AccountField>
        <AccountField htmlFor="password-new" label={t("auth.password.new")}>
          <PasswordInput
            purpose="new"
            id="password-new"
            name="newPassword"
            required
          />
        </AccountField>
        <AccountField htmlFor="password-confirm" label={t("profile.confirmPassword")}>
          <PasswordInput
            purpose="new"
            id="password-confirm"
            name="confirmPassword"
            required
          />
        </AccountField>
        <div className="flex justify-end">
          <Rm2kButton type="submit">{t("profile.changePassword")}</Rm2kButton>
        </div>
      </RedirectForm>
    </div>
  );
}
