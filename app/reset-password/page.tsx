import { runtimeContext } from "@/app/.server/router-context";
import { routeInput } from "@/app/.server/route-input";
import {
  EmailInput,
  PasswordInput,
  VerificationCodeInput,
} from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Notice } from "@/app/components/ui/notice";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { RedirectForm } from "@/app/components/ui/redirect-form";

export async function loader(args: LoaderFunctionArgs) {
  const { searchParams } = routeInput(args);

  const params = Object.fromEntries(
    Object.entries(searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const nextPath = sanitizeRedirectPath(params.next, "/login");

  return { params, nextPath, locale: args.context.get(runtimeContext).uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "auth.reset.title") }, error, locale);
};

export default function ResetPasswordPage() {
  const { params, nextPath } = useLoaderData<typeof loader>();
  const t = useMessages();
  return (
    <AuthPageShell
      title={t("auth.reset.title")}
      footer={
        <>
          <Link to={`/forgot-password?next=${encodeURIComponent(nextPath)}`}>
            {t("auth.code.resend")}
          </Link>
          <Link to={`/login?next=${encodeURIComponent(nextPath)}`}>
            {t("auth.backToLogin")}
          </Link>
        </>
      }
    >
      {params.sent ? (
        <Notice tone="success" className="mb-4 rounded-md border p-3">
          {t("auth.reset.sent")}
        </Notice>
      ) : null}
      <RedirectFeedback />
      <RedirectForm
        action="/api/auth/password-reset/confirm"
        preserveLanguage
        method="post"
        className="grid gap-4"
      >
        <input type="hidden" name="next" value={nextPath} />
        <FormField controlId="reset-password-field-1" label={t("auth.email")}>
          <EmailInput
            id="reset-password-field-1"
            defaultValue={params.email ?? ""}
            name="email"
            placeholder="name@example.com"
            required
          />
        </FormField>
        <FormField controlId="reset-password-field-2" label={t("auth.code.label")}>
          <VerificationCodeInput
            id="reset-password-field-2"
            name="code"
            required
          />
        </FormField>
        <FormField controlId="reset-password-field-3" label={t("auth.password.new")}>
          <PasswordInput
            id="reset-password-field-3"
            purpose="new"
            name="password"
            required
          />
        </FormField>
        <Button type="submit">{t("auth.password.update")}</Button>
      </RedirectForm>
    </AuthPageShell>
  );
}
