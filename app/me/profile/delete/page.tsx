import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale } from "@/lib/i18n/react";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { requestJson } from "@/lib/ui/api-response";

import { useState } from "react";
import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { redirectPage } from "@/app/.server/http/page-response";
import { runtimeContext } from "@/app/.server/router-context";
import { VerificationCodeInput } from "@/app/components/auth/auth-input";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Notice } from "@/app/components/ui/notice";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { RedirectForm } from "@/app/components/ui/redirect-form";
import { useToast } from "@/app/components/ui/toast";
import { ACCOUNT_DELETION_ACKNOWLEDGEMENT } from "@/lib/auth/account-deletion";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const user = await requireAccountUser(runtime, "/me/profile/delete");
  if (user.isBootstrapAdmin) redirectPage("/me/profile", args.request);
  return { email: user.email, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "profile.deleteAccount"), translate(locale, "header.me")] }, error, locale);
};

export default function DeleteAccountPage() {
  const t = useMessages();
  const locale = useNavigationLocale();
  const { email } = useLoaderData<typeof loader>();
  const toast = useToast();
  const [acknowledgement, setAcknowledgement] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const acknowledged = acknowledgement === ACCOUNT_DELETION_ACKNOWLEDGEMENT;

  async function sendCode() {
    if (!acknowledged || sending || submitting) return;
    setSending(true);
    try {
      const body = new FormData();
      body.set("acknowledgement", acknowledgement);

      await requestJson(locale ? `/api/account/delete/start?${UI_LOCALE_PARAM}=${locale}` : "/api/account/delete/start", {
        method: "POST",
        body,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });

      setSent(true);
      toast.success(t("account.delete.codeSent"));
    } catch (error) {
      toast.error(
        error instanceof TypeError
          ? t("relation.edit.network")
          : error instanceof Error ? error : t("profile.codeFailed"),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <AccountPageHeader parentTitle={t("account.nav.profile")} title={t("profile.deleteAccount")} />
      <div className="max-w-2xl space-y-6">
        <section
          aria-labelledby="account-deletion-warning"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-5"
        >
          <h2 id="account-deletion-warning" className="font-semibold text-destructive">
            {t("account.delete.warning")}
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>{t("account.delete.signOut")}</li>
            <li>{t("account.delete.profileEffects")}</li>
            <li>{t("account.delete.contributions")}</li>
          </ul>
        </section>

        <RedirectForm
          action="/api/account/delete"
          preserveLanguage
          className="space-y-6"
          method="post"
          onBusyChange={setSubmitting}
        >
          <div className="space-y-2">
            <Label htmlFor="delete-account-acknowledgement">{t("account.delete.confirmEffects")}</Label>
            <p id="delete-account-acknowledgement-help" className="text-sm text-muted">
              {t("account.delete.typePhrase")}
              <strong lang="zh-Hans" className="font-semibold text-foreground">{ACCOUNT_DELETION_ACKNOWLEDGEMENT}</strong>
            </p>
            <Input
              id="delete-account-acknowledgement"
              name="acknowledgement"
              autoComplete="off"
              aria-describedby="delete-account-acknowledgement-help"
              value={acknowledgement}
              onChange={(event) => setAcknowledgement(event.target.value)}
              pattern={ACCOUNT_DELETION_ACKNOWLEDGEMENT}
              maxLength={ACCOUNT_DELETION_ACKNOWLEDGEMENT.length}
              readOnly={sending || submitting}
              required
            />
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">{t("account.delete.verifyEmail")}</h2>
            <p className="break-all text-sm text-muted">
              {t("account.delete.codeDestination")}<strong className="font-semibold text-foreground">{email}</strong>
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={!acknowledged || sending || submitting}
              onClick={() => void sendCode()}
            >
              {sending ? t("account.delete.sending") : sent ? t("auth.code.resend") : t("account.delete.getCode")}
            </Button>
            {sent ? (
              <Notice tone="success">
                {t("account.delete.latestCode")}
              </Notice>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="delete-account-code">{t("account.delete.emailCode")}</Label>
              <VerificationCodeInput
                id="delete-account-code"
                name="code"
                disabled={!sent || !acknowledged || sending || submitting}
                placeholder={t("account.delete.sixDigits")}
                required
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-border pt-5">
            <p className="text-sm text-destructive">{t("account.delete.finalWarning")}</p>
            <div className="flex flex-wrap items-center justify-end gap-4">
              <Link className="text-sm font-semibold text-primary hover:underline" to="/me/profile">
                {t("account.delete.back")}
              </Link>
              <Button
                type="submit"
                variant="destructive"
                disabled={!acknowledged || !sent || sending || submitting}
              >
                {submitting ? t("account.delete.deleting") : t("account.delete.permanent")}
              </Button>
            </div>
          </div>
        </RedirectForm>
      </div>
    </div>
  );
}
