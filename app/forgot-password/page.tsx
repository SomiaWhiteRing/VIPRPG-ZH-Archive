import { runtimeContext } from "@/app/.server/router-context";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { routeInput } from "@/app/.server/route-input";
import { EmailInput } from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
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
  return pageMetaDescriptors({ title: translate(locale, "auth.forgot") }, error, locale);
};

export default function ForgotPasswordPage() {
  const { params, nextPath } = useLoaderData<typeof loader>();
  const t = useMessages();
  return (
    <AuthPageShell
      title={t("auth.forgot")}
      footer={
        <>
          <Link to={`/login?next=${encodeURIComponent(nextPath)}`}>
            {t("auth.backToLogin")}
          </Link>
        </>
      }
    >
      <RedirectFeedback />
      <RedirectForm
        action="/api/auth/password-reset/start"
        preserveLanguage
        method="post"
        className="grid gap-4"
      >
        <input type="hidden" name="next" value={nextPath} />
        <FormField controlId="forgot-password-field-1" label={t("auth.email")}>
          <EmailInput
            id="forgot-password-field-1"
            defaultValue={params.email ?? ""}
            name="email"
            placeholder="name@example.com"
            required
          />
        </FormField>
        <Button type="submit">{t("auth.code.send")}</Button>
      </RedirectForm>
    </AuthPageShell>
  );
}
