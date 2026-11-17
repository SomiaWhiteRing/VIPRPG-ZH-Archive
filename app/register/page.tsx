import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import {
  EmailInput,
  PasswordInput,
  VerificationCodeInput,
} from "@/app/components/auth/auth-input";
import { AuthPageShell } from "@/app/components/auth/auth-page-shell";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import { getCurrentUser } from "@/app/.server/auth/current-user";
import { authReturnUrl, sanitizeRedirectPath } from "@/app/.server/auth/redirect";
import { redirectPage } from "@/app/.server/http/page-response";
import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Notice } from "@/app/components/ui/notice";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
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
  return pageMetaDescriptors({ title: translate(locale, "auth.signUp") }, error, locale);
};

export default function RegisterPage() {
  const { params, nextPath } = useLoaderData<typeof loader>();
  const t = useMessages();
  return (
    <AuthPageShell
      title={t("auth.signUp")}
      footer={
        <>
          <Link to={`/login?next=${encodeURIComponent(nextPath)}`}>
            {t("auth.backToLogin")}
          </Link>
        </>
      }
    >
      <RedirectFeedback />
      {params.sent ? (
        <VerificationForm email={params.email ?? ""} nextPath={nextPath} />
      ) : (
        <RegisterStartForm
          nextPath={nextPath}
          email={params.email ?? ""}
          displayName={params.displayName ?? ""}
        />
      )}
    </AuthPageShell>
  );
}

function RegisterStartForm({ nextPath, email, displayName }: {
  nextPath: string;
  email: string;
  displayName: string;
}) {
  const t = useMessages();
  return (
    <RedirectForm
      action="/api/auth/register/start"
      preserveLanguage
      method="post"
      className="grid gap-4"
      onInput={(event) => {
        const fields = event.currentTarget.elements;
        const password = fields.namedItem("password");
        const confirmation = fields.namedItem("confirmPassword");
        if (password instanceof HTMLInputElement && confirmation instanceof HTMLInputElement) {
          confirmation.setCustomValidity(
            confirmation.value && confirmation.value !== password.value
              ? t("auth.password.mismatch") : "",
          );
        }
      }}
    >
      <input type="hidden" name="next" value={nextPath} />
      <FormField controlId="register-display-name" label={t("auth.displayName")}>
        <Input
          id="register-display-name"
          name="displayName"
          autoComplete="nickname"
          defaultValue={displayName}
          maxLength={80}
          required
        />
      </FormField>
      <FormField controlId="register-field-1" label={t("auth.email")}>
        <EmailInput
          id="register-field-1"
          name="email"
          defaultValue={email}
          placeholder={undefined}
          required
        />
      </FormField>
      <FormField controlId="register-field-2" label={t("auth.password")}>
        <PasswordInput
          id="register-field-2"
          purpose="new"
          name="password"
          placeholder={t("auth.password.hint")}
          required
        />
      </FormField>
      <FormField controlId="register-confirm-password" label={t("auth.password.confirm")}>
        <PasswordInput
          id="register-confirm-password"
          purpose="new"
          name="confirmPassword"
          required
        />
      </FormField>
      <Button type="submit">{t("auth.code.send")}</Button>
    </RedirectForm>
  );
}

function VerificationForm({
  email,
  nextPath,
}: {
  email: string;
  nextPath: string;
}) {
  const t = useMessages();
  return (
    <RedirectForm
      action="/api/auth/register/verify"
      responseType="json"
      preserveLanguage
      method="post"
      className="grid gap-4"
    >
      <Notice tone="success" className="mb-4 rounded-md border p-3">
        {t("auth.register.sent", { email })}
      </Notice>
      <input type="hidden" name="next" value={nextPath} />
      <input type="hidden" name="email" value={email} />
      <FormField controlId="register-field-3" label={t("auth.code.label")}>
        <VerificationCodeInput id="register-field-3" name="code" required />
      </FormField>
      <Button type="submit">{t("auth.register.finish")}</Button>
    </RedirectForm>
  );
}
