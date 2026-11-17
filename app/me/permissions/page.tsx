import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";

import { requireAccountUser } from "@/app/.server/auth/account-user";
import { listAccountRoleOptions } from "@/app/.server/db/permissions";
import { runtimeContext } from "@/app/.server/router-context";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Label } from "@/app/components/ui/label";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { Rm2kButton } from "@/app/components/ui/rm2k-button";
import { Textarea } from "@/app/components/ui/textarea";
import { useToast } from "@/app/components/ui/toast";
import type { AccountRoleOption } from "@/lib/dto/db/permissions";
import { notifyInboxChanged } from "@/lib/inbox-events";
import { cn } from "@/lib/ui/cn";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { useState, useTransition, type FormEvent } from "react";
import { useLoaderData, useRevalidator, useSearchParams, type LoaderFunctionArgs, type MetaFunction } from "react-router";
export { shouldRevalidatePermissionPanel as shouldRevalidate } from "@/lib/ui/route-revalidation";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const user = await requireAccountUser(runtime, "/me/permissions");
  return { locale: runtime.uiLocale, roles: await listAccountRoleOptions(runtime, user) };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "account.nav.permissions"), translate(locale, "header.me")] }, error, locale);
};

export default function AccountPermissionsPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const navigationLocale = useNavigationLocale();
  const { roles } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const selectedKey = params.get("role");
  const role = roles.find((item) => item.key === selectedKey) ?? roles[0];
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const revalidator = useRevalidator();
  const toast = useToast();
  const state = role ? applicationState(role, t) : null;
  const busy = saving || refreshing;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role || !state?.canApply || busy) return;
    setSaving(true);
    try {

      await requestJson(`/api/account/role-requests?${UI_LOCALE_PARAM}=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId: role.id, reason: reasons[role.id] ?? "" }),
      });

      setReasons((current) => ({ ...current, [role.id]: "" }));
      notifyInboxChanged();
      startTransition(() => revalidator.revalidate());
      toast.success(t("account.permissions.submitted"));
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 409)
        startTransition(() => revalidator.revalidate());
      toast.error(error instanceof ApiResponseError ? error.messageFor(locale) : error instanceof Error ? error.message : t("account.permissions.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <AccountPageHeader title={t("account.nav.permissions")} />
      {role && state ? (
        <div className="flex flex-col items-start gap-5 lg:flex-row lg:gap-6">
          <nav className="grid w-full min-w-0 shrink-0 grid-cols-2 gap-2 lg:w-44 lg:grid-cols-1" aria-label={t("account.permissions.choose")}>
            {roles.map((item) => {
              const itemState = applicationState(item, t);
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="outline"
                  className={cn(
                    "h-auto min-w-0 flex-col items-start gap-2 whitespace-normal p-3 text-left hover:bg-primary/5",
                    item.id === role.id && "border-primary bg-primary/10",
                  )}
                  aria-pressed={item.id === role.id}
                  aria-controls="permission-detail"
                  disabled={busy}
                  onClick={() => setParams((current) => {
                    current.set("role", item.key);
                    if (navigationLocale) current.set(UI_LOCALE_PARAM, navigationLocale);
                    return current;
                  }, { replace: true, preventScrollReset: true })}
                >
                  <span className="max-w-full wrap-anywhere">{item.name}</span>
                  <Badge variant={itemState.variant}>{itemState.label}</Badge>
                </Button>
              );
            })}
          </nav>
          <Card id="permission-detail" className="grid w-full min-w-0 flex-1 grid-cols-1 gap-4 p-4 sm:p-6" aria-labelledby="permission-heading">
            <div>
              <h2 id="permission-heading" className="wrap-anywhere text-lg font-semibold">{role.name}</h2>
              {role.description ? (
                <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm text-muted">{role.description}</p>
              ) : null}
            </div>
            {state.message ? <p className="text-sm text-muted" role="status">{state.message}</p> : null}
            {role.request?.rejectionReason ? <p className="whitespace-pre-wrap wrap-anywhere text-sm"><span className="font-semibold">{t("account.permissions.rejection")}</span>{role.request.rejectionReason}</p> : null}
            {role.request ? (
              <Link className="w-fit text-sm text-primary hover:underline" to={`/inbox/${role.request.id}`}>
                {t("account.permissions.latest")}
              </Link>
            ) : null}
            {state.canApply ? (
              <form className="grid gap-3 border-t border-border pt-5" onSubmit={submit}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="application-reason">
                    {t("account.permissions.reason")}
                  </Label>
                  <span id="application-reason-count" className="text-xs tabular-nums text-muted">
                    {(reasons[role.id] ?? "").length} / 2000
                  </span>
                </div>
                <Textarea
                  id="application-reason"
                  name="reason"
                  aria-describedby="application-reason-count application-reason-privacy"
                  maxLength={2000}
                  rows={5}
                  disabled={busy}
                  placeholder={t("account.permissions.placeholder")}
                  value={reasons[role.id] ?? ""}
                  onChange={(event) => setReasons((current) => ({ ...current, [role.id]: event.target.value }))}
                />
                <div className="flex justify-end pt-2">
                  <Rm2kButton type="submit" disabled={busy}>
                    {busy ? t("account.permissions.sending") : role.request ? t("account.permissions.again") : t("account.permissions.submit")}
                  </Rm2kButton>
                </div>
              </form>
            ) : null}
          </Card>
        </div>
      ) : <EmptyState title={t("account.permissions.empty")} />}
    </div>
  );
}

function applicationState(role: AccountRoleOption, t: ReturnType<typeof useMessages>): {
  canApply: boolean;
  label: string;
  variant: "subtle" | "positive" | "pending" | "neutral";
  message: string | null;
} {
  if (role.status !== "active") return {
    canApply: false, label: t("account.permissions.inactive"), variant: "neutral", message: t("account.permissions.inactiveHint"),
  };
  if (role.availableToAll) return {
    canApply: false, label: t("account.permissions.available"), variant: "positive",
    message: [ t("account.permissions.availableHint"), role.individuallyAssigned ? t("account.permissions.assignedHint") : null ].filter(Boolean).join(" "),
  };
  if (role.granted) return {
    canApply: false, label: t("account.permissions.granted"), variant: "positive", message: t("account.permissions.grantedHint"),
  };
  if (role.request?.status === "pending") return {
    canApply: false, label: t("account.permissions.pending"), variant: "pending", message: t("account.permissions.pendingHint"),
  };
  if (!role.applicationEnabled) return {
    canApply: false, label: t("account.permissions.closed"), variant: "neutral", message: t("account.permissions.closedHint"),
  };
  if (role.request?.status === "rejected") return {
    canApply: true, label: t("account.permissions.reapply"), variant: "pending", message: t("account.permissions.rejectedHint"),
  };
  if (role.request?.status === "archived") return {
    canApply: true, label: t("account.permissions.reapply"), variant: "subtle", message: t("account.permissions.archivedHint"),
  };
  if (role.request?.status === "approved") return {
    canApply: true, label: t("account.permissions.reapply"), variant: "pending", message: t("account.permissions.approvedHint"),
  };
  return { canApply: true, label: t("account.permissions.open"), variant: "subtle", message: null };
}
