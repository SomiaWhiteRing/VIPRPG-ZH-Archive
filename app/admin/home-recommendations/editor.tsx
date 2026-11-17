import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { Button } from "@/app/components/ui/button";
import { useConfirm } from "@/app/components/ui/confirm-provider";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FormField } from "@/app/components/ui/form-field";
import { Notice } from "@/app/components/ui/notice";
import { SearchComboBox } from "@/app/components/ui/search-combobox";
import { useToast } from "@/app/components/ui/toast";
import { useNavigationGuard } from "@/app/components/ui/use-navigation-guard";
import type { HomeRecommendation } from "@/lib/home-recommendations";
import { requestJson } from "@/lib/ui/api-response";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { StickySaveBar } from "@/app/admin/admin-list-controls";

type Candidate = Pick<HomeRecommendation, "id" | "originalTitle" | "chineseTitle">;

export function HomeRecommendationsEditor({ initialWorks }: { initialWorks: HomeRecommendation[] }) {
  const t = useMessages();
  const locale = useUiLocale();
  const [works, setWorks] = useState(initialWorks);
  const [savedIds, setSavedIds] = useState(initialWorks.map((work) => work.id));
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const inputId = useId();
  const toast = useToast();
  const confirm = useConfirm();
  const selectedIds = works.map((work) => work.id).join(",");
  const dirty = selectedIds !== savedIds.join(",");
  useNavigationGuard(dirty || busy, () => !busy && confirm(t("admin.recommendations.discard")));

  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void requestJson<{ ok: true; works: Candidate[] }>(
        `/api/works/lookup?scope=home&title=${encodeURIComponent(query.trim())}&${UI_LOCALE_PARAM}=${locale}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ excludeWorkIds: selectedIds }), signal: controller.signal }, t("admin.recommendations.searchFailed"),
      ).then((result) => { if (!controller.signal.aborted) setCandidates(result.works); })
        .catch((error) => { if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : t("admin.recommendations.searchFailed")); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [locale, query, selectedIds, t]);

  function changeQuery(value: string) {
    setQuery(value); setCandidates([]); setSearchError(""); setSearching(Boolean(value.trim()));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current || !dirty) return;
    running.current = true; setBusy(true);
    try {
      const result = await requestJson<{ ok: true; works: HomeRecommendation[] }>(`/api/admin/home-recommendations?${UI_LOCALE_PARAM}=${locale}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workIds: works.map((work) => work.id) }),
      }, t("admin.recommendations.saveFailed"));
      setWorks(result.works); setSavedIds(result.works.map((work) => work.id));
      toast.success(t("admin.recommendations.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("admin.recommendations.saveFailed"));
    } finally {
      running.current = false; setBusy(false);
    }
  }

  return (
    <form className="grid gap-5" onSubmit={(event) => void save(event)}>
      <FormField label={t("admin.recommendations.add")} controlId={inputId}>
        <SearchComboBox id={inputId} label={t("admin.recommendations.addRecommended")} query={query} onQueryChange={changeQuery}
          placeholder={t("admin.recommendations.search")} maxLength={200} loading={searching}
          disabled={busy}
          items={candidates.filter((candidate) => !works.some((work) => work.id === candidate.id))}
          selectedKey={null} getKey={(work) => work.id} getText={(work) => work.chineseTitle || work.originalTitle}
          renderItem={(work) => <span className="grid gap-0.5">
            <span>{work.chineseTitle || work.originalTitle}</span>
            {work.chineseTitle ? <span className="text-xs text-muted">{work.originalTitle}</span> : null}
          </span>}
          onChoose={(candidate) => {
            setWorks((current) => !current.some((work) => work.id === candidate.id)
              ? [...current, { ...candidate, isPublic: true }] : current);
            changeQuery("");
          }}
          onClear={() => changeQuery("")}
          emptyState={searchError || (query.trim() ? t("admin.recommendations.noMatches") : t("admin.recommendations.prompt"))} />
      </FormField>
      {works.some((work) => !work.isPublic) ? <Notice tone="warning">{t("admin.recommendations.unavailable")}</Notice> : null}
      {works.length ? (
        <ul className="admin-panel m-0 grid list-none divide-y divide-border" aria-label={t("admin.recommendations.games")}>
          {works.map((work) => (
            <li key={work.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1 basis-40">
                <Link className="wrap-anywhere font-semibold hover:underline" to={`/admin/works/${work.id}`}>
                  {work.chineseTitle || work.originalTitle}
                </Link>
                {work.chineseTitle ? <p className="mt-0.5 wrap-anywhere text-xs text-muted">{work.originalTitle}</p> : null}
                {!work.isPublic ? <span className="text-xs text-muted">{t("admin.recommendations.ineligible")}</span> : null}
              </div>
              <Button type="button" variant="ghost" size="sm" className="shrink-0" disabled={busy}
                aria-label={t("admin.recommendations.remove", { name: work.chineseTitle || work.originalTitle })}
                onClick={() => setWorks((current) => current.filter((item) => item.id !== work.id))}>{t("core.action.remove")}</Button>
            </li>
          ))}
        </ul>
      ) : <EmptyState title={t("admin.recommendations.empty")} />}
      <StickySaveBar><Button type="submit" disabled={busy || !dirty}>{busy ? t("admin.discussionTags.saving") : t("admin.recommendations.save")}</Button>
        <span className="text-xs text-muted" role="status">{dirty ? t("admin.recommendations.dirty") : t("admin.recommendations.current")}</span>
      </StickySaveBar>
    </form>
  );
}
