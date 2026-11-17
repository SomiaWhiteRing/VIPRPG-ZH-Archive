import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { EmailInput, PasswordInput } from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { getCurrentUser } from "@/app/.server/auth/current-user";
import { authReturnUrl, sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { redirectPage } from "@/app/.server/http/page-response";
import { FormField } from "@/app/components/ui/form-field";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { RedirectForm } from "@/app/components/ui/redirect-form";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  const params = Object.fromEntries(
    Object.entries(searchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const nextPath = sanitizeRedirectPath(params.next);
  const currentUser = await getCurrentUser(runtime);

  if (currentUser) {
    const target = authReturnUrl(nextPath, args.request.url);
    redirectPage(target.pathname + target.search + target.hash);
  }

  return { params, nextPath, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "core.login") }, error, locale);
};

export default function LoginPage() {
  const { params, nextPath } = useLoaderData<typeof loader>();
  const t = useMessages();
  return (
    <AuthPageShell
      title={t("core.login")}
      footer={
        <>
          <Link to={`/register?next=${encodeURIComponent(nextPath)}`}>
            {t("auth.register")}
          </Link>
          <Link to={`/forgot-password?next=${encodeURIComponent(nextPath)}`}>
            {t("auth.forgot")}
          </Link>
        </>
      }
    >
      <RedirectFeedback success={{ reset: t("auth.reset.done"), accountDeleted: t("auth.deleted") }} />

      <RedirectForm action="/api/auth/login" responseType="json" preserveLanguage method="post" className="grid gap-4">
        <input type="hidden" name="next" value={nextPath} />
        <FormField controlId="login-field-1" label={t("auth.email")}>
          <EmailInput
            id="login-field-1"
            defaultValue={params.email ?? ""}
            name="email"
            placeholder={undefined}
            required
          />
        </FormField>
        <FormField controlId="login-field-2" label={t("auth.password")}>
          <PasswordInput id="login-field-2" name="password" required />
        </FormField>
        <Rm2kButton type="submit">{t("core.login")}</Rm2kButton>
      </RedirectForm>
    </AuthPageShell>
  );
}
