import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";

import { useRef, useState, type FormEvent } from "react";
import { data, useLoaderData, useRevalidator, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requireAccountUser } from "@/app/.server/auth/account-user";
import { readTimelineSettings } from "@/app/.server/db/timeline";
import { runtimeContext } from "@/app/.server/router-context";
import { AccountPageHeader } from "@/app/me/account-page-header";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { Notice } from "@/app/components/ui/notice";
import { SelectField } from "@/app/components/ui/select";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import { useToast } from "@/app/components/ui/toast";
import { TIMELINE_RECORD_KINDS, isTimelineDefaultView, type TimelineSettings } from "@/lib/dto/db/timeline";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";

export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const user = await requireAccountUser(runtime, "/me/timeline");
  return data({ locale: runtime.uiLocale, userId: user.id, canRecord: hasPermission(user, "timeline.use"), settings: await readTimelineSettings(runtime, user.id) }, { headers: { "Cache-Control": "private, no-store" } });
}
export function headers() { return { "Cache-Control": "private, no-store" }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "timeline.feed.settings") }, error, locale);
};

export default function TimelineSettingsPage() {
  const { userId, settings, canRecord } = useLoaderData<typeof loader>();
  return <TimelineSettingsForm key={userId} userId={userId} initial={settings} canRecord={canRecord} />;
}

function TimelineSettingsForm({ userId, initial, canRecord }: { userId: number; initial: TimelineSettings; canRecord: boolean }) {
  const t = useMessages();
  const locale = useUiLocale();
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [timelineAsHomepage, setTimelineAsHomepage] = useState(initial.timelineAsHomepage);
  const [defaultView, setDefaultView] = useState(initial.defaultView);
  const [kinds, setKinds] = useState(new Set(initial.recordKinds));
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const submitting = useRef(false);
  const toast = useToast();
  const confirm = useConfirm();
  const revalidator = useRevalidator();
  const recordKinds = TIMELINE_RECORD_KINDS.filter((kind) => kinds.has(kind));
  const dirty = enabled !== saved.enabled || timelineAsHomepage !== saved.timelineAsHomepage || defaultView !== saved.defaultView || TIMELINE_RECORD_KINDS.some((kind) => kinds.has(kind) !== saved.recordKinds.includes(kind));
  useNavigationGuard(dirty || busy, () => !busy && confirm(t("timeline.settings.discardPrompt"), { confirmLabel: t("timeline.settings.discard") }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setRecovery(false);
    try {

      const result = await requestJson(`/api/account/timeline?${UI_LOCALE_PARAM}=${locale}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, recordKinds, timelineAsHomepage, defaultView }) }, t("timeline.settings.failed")) as { settings?: TimelineSettings; detail?: string; error?: string };

      const next = result.settings ?? { enabled, recordKinds, timelineAsHomepage, defaultView };
      setSaved(next);
      setEnabled(next.enabled);
      setTimelineAsHomepage(next.timelineAsHomepage);
      setDefaultView(next.defaultView);
      setKinds(new Set(next.recordKinds));
      toast.success(t("timeline.settings.saved"));
      await revalidator.revalidate();
    } catch (error) {
      setRecovery(true);
      toast.error(error instanceof ApiResponseError ? error.messageFor(locale) : error instanceof Error ? error.message : t("timeline.settings.failed"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <div>
    <AccountPageHeader title={t("timeline.settings.title")} actions={<Button asChild size="sm" variant="outline"><Link to={`/users/${userId}/timeline`}>{t("timeline.settings.my")}</Link></Button>} />
    <form onSubmit={(event) => void submit(event)} aria-busy={busy} className="mt-5 grid gap-6">
      {!canRecord && <Notice tone="warning">{t("timeline.settings.denied")}</Notice>}
      <section aria-labelledby="timeline-switch-heading" className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex min-h-10 items-center gap-3">
          <Checkbox id="timeline-enabled" checked={enabled} onCheckedChange={(value) => setEnabled(value === true)} disabled={busy || (!canRecord && !enabled)} aria-describedby="timeline-enabled-help" />
          <Label id="timeline-switch-heading" htmlFor="timeline-enabled" className="cursor-pointer text-base font-semibold">{t("timeline.feed.enable")}</Label>
        </div>
        <p id="timeline-enabled-help" className="mb-0 mt-2 text-sm leading-relaxed text-muted">{t("timeline.settings.off")}</p>
        {enabled && <div className="mt-4 border-t border-border pt-3">
          <div className="flex min-h-10 items-center gap-3">
            <Checkbox id="timeline-as-homepage" checked={timelineAsHomepage} onCheckedChange={(value) => setTimelineAsHomepage(value === true)} disabled={busy} aria-describedby="timeline-as-homepage-help" />
            <Label htmlFor="timeline-as-homepage" className="cursor-pointer font-semibold">{t("timeline.settings.home")}</Label>
          </div>
          <div className="mt-4 grid gap-2 sm:max-w-xs">
            <Label htmlFor="timeline-default-view" className="font-semibold">{t("timeline.settings.default")}</Label>
            <SelectField id="timeline-default-view" value={defaultView} disabled={busy} options={[{ value: "following", label: t("timeline.feed.following") }, { value: "all", label: t("timeline.feed.all") }]} onValueChange={(value) => { if (isTimelineDefaultView(value)) setDefaultView(value); }} aria-describedby="timeline-default-view-help" />
          </div>
        </div>}
      </section>
      {enabled && <fieldset disabled={busy} className="min-w-0">
        <legend className="text-base font-semibold">{t("timeline.settings.record")}</legend>
        <div className="divide-y divide-border border-y border-border">
          {TIMELINE_RECORD_KINDS.map((kind) => <div key={kind} className="flex items-start gap-3 py-3">
            <Checkbox className="mt-1" id={`timeline-kind-${kind}`} checked={kinds.has(kind)} onCheckedChange={(value) => setKinds((current) => { const next = new Set(current); if (value === true) next.add(kind); else next.delete(kind); return next; })} aria-describedby={`timeline-kind-${kind}-help`} />
            <div className="min-w-0"><Label htmlFor={`timeline-kind-${kind}`} className="cursor-pointer font-semibold">{t(`timeline.feed.kind.${kind}`)}</Label><p id={`timeline-kind-${kind}-help`} className="mb-0 mt-1 text-sm text-muted">{t(`timeline.settings.desc.${kind}`)}</p></div>
          </div>)}
        </div>
      </fieldset>}
      <Button type="submit" className="justify-self-start" disabled={busy || !dirty}>{busy ? t("admin.discussionTags.saving") : t("timeline.settings.save")}</Button>
      {recovery && <p role="status" className="m-0 text-sm text-muted">{t("timeline.settings.retry")}<Link to="/login?next=%2Fme%2Ftimeline" target="_blank" rel="noopener noreferrer" className="text-primary underline">{t("timeline.feed.signIn")}</Link>{t("timeline.settings.retryEnd")}</p>}
    </form>
  </div>;
}

export { TimelineError as ErrorBoundary } from "@/app/components/timeline/timeline-error";
