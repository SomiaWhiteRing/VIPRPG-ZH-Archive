import { useMessages } from "@/lib/i18n/react";
import { translate } from "@/lib/i18n/core";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { pickPageFields } from "@/app/.server/page-data";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import {
  EmailInput,
  PasswordInput,
  VerificationCodeInput,
} from "@/app/components/auth/auth-input";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { requireAccountUser } from "@/app/.server/auth/account-user";
import { AccountField } from "@/app/components/profile/account-field";
import { Input } from "@/app/components/ui/input";
import { Notice } from "@/app/components/ui/notice";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { RedirectForm } from "@/app/components/ui/redirect-form";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const user = await requireAccountUser(runtime, "/me/profile/email");
  const params = await searchParams;

  return { locale: runtime.uiLocale, user: pickPageFields(user, ["email"]), params };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "profile.changeLoginEmail"), translate(locale, "header.me")] }, error, locale);
};

export default function EmailPage() {
  const t = useMessages();
  const { user, params } = useLoaderData<typeof loader>();
  return (
    <div>
      <AccountPageHeader parentTitle={t("account.nav.profile")} title={t("profile.changeLoginEmail")} />
      <RedirectFeedback success={{ emailUpdated: t("profile.emailUpdated") }} />
      {params.emailSent ? (
        <Notice
          tone="success"
          className="mb-4 rounded-md px-4 py-3 text-sm"
          role="status"
        >
          {t("profile.emailCodeSent")}
        </Notice>
      ) : null}

      <div className="max-w-2xl">
        <p className="mb-5 text-sm text-muted">
          {t("profile.currentEmail")}
          <span className="font-semibold text-foreground">{user.email}</span>
        </p>
        {params.emailSent && params.newEmail ? (
          <RedirectForm
            action="/api/account/email/confirm" preserveLanguage
            className="grid gap-4"
            method="post"
          >
            <Input name="newEmail" type="hidden" value={params.newEmail} />
            <AccountField htmlFor="email-change-new" label={t("profile.newEmail")}>
              <Input disabled id="email-change-new" value={params.newEmail} />
            </AccountField>
            <AccountField htmlFor="email-change-code" label={t("auth.code.label")}>
              <VerificationCodeInput
                id="email-change-code"
                name="code"
                required
              />
            </AccountField>
            <div className="flex justify-end">
              <Rm2kButton type="submit">{t("profile.confirmEmail")}</Rm2kButton>
            </div>
          </RedirectForm>
        ) : (
          <RedirectForm
            action="/api/account/email/start" preserveLanguage
            className="grid gap-4"
            method="post"
          >
            <AccountField htmlFor="email-change-address" label={t("profile.newEmail")}>
              <EmailInput
                defaultValue={params.newEmail}
                id="email-change-address"
                name="newEmail"
                required
              />
            </AccountField>
            <AccountField htmlFor="email-change-password" label={t("profile.currentPassword")}>
              <PasswordInput
                id="email-change-password"
                name="currentPassword"
                required
              />
            </AccountField>
            <div className="flex justify-end">
              <Rm2kButton type="submit">{t("auth.code.send")}</Rm2kButton>
            </div>
          </RedirectForm>
        )}
      </div>
    </div>
  );
}
