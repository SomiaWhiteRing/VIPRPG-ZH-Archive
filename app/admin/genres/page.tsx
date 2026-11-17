import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getWorkGenreGroup, listWorkGenreGroups } from "@/app/.server/db/work-genres";
import { runtimeContext } from "@/app/.server/router-context";
import { parseAdminPage } from "@/app/admin/admin-list-controls";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Button } from "@/app/components/ui/button";
import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { PageHeader } from "@/app/components/ui/page-header";
import { AdminListMeta } from "@/app/admin/admin-list-controls";
import { RedirectFeedback } from "@/app/components/ui/redirect-feedback";
import { RedirectForm } from "@/app/components/ui/redirect-form";
import { formatNumber } from "@/lib/format";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { WORK_GENRE_MAX_LENGTH } from "@/lib/work-genre";
import { Pencil } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  await requirePagePermission(runtime, "/admin/genres", "genre.manage");
  const params = new URL(args.request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, WORK_GENRE_MAX_LENGTH);
  const source = (params.get("source") ?? "").trim().slice(0, WORK_GENRE_MAX_LENGTH);
  const target = (params.get("target") ?? "").trim().slice(0, WORK_GENRE_MAX_LENGTH);
  const page = parseAdminPage(params.get("page") ?? undefined);
  const result = await listWorkGenreGroups(runtime, query, page);
  const sourceMembers = source ? await getWorkGenreGroup(runtime, source) : [];
  const targetMembers = target ? await getWorkGenreGroup(runtime, target) : [];
  return { query, source, target, page, result, sourceMembers, targetMembers, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({
    title: [translate(locale, "admin.permissions.category.genre"), translate(locale, "admin.characterIndex.console")],
  }, error, locale);
};

export default function AdminGenresPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const navigationLocale = useNavigationLocale();
  const separator = locale === "en" ? ", " : "、";
  const { query, source, target, page, result, sourceMembers, targetMembers } = useLoaderData<typeof loader>();
  const [sourceValue, setSourceValue] = useState(source);
  const [targetValue, setTargetValue] = useState(target);
  const sourceInput = useRef<HTMLInputElement>(null);
  const targetInput = useRef<HTMLInputElement>(null);
  const mergePanel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    setSourceValue(source);
    setTargetValue(target);
  }, [source, target]);
  const emptySlot = !sourceValue.trim() ? "A" : !targetValue.trim() ? "B" : null;
  const previewMatches = sourceValue.trim() === source && targetValue.trim() === target;
  const canMerge = sourceMembers.length > 0 && targetMembers.length > 0
    && sourceMembers[0].group_id !== targetMembers[0].group_id;
  function fillMergeSlot(name: string) {
    if (mergePanel.current) mergePanel.current.open = true;
    if (emptySlot === "A") {
      setSourceValue(name);
      sourceInput.current?.focus();
    } else if (emptySlot === "B") {
      setTargetValue(name);
      targetInput.current?.focus();
    }
  }
  return <main className="grid gap-6">
    <PageHeader compact title={t("admin.permissions.category.genre")} />
    <RedirectFeedback />
    <details ref={mergePanel} className="admin-panel admin-details" open={Boolean(source || target)}>
      <summary>{t("admin.genres.merge")}</summary>
      <form action="/admin/genres" method="get" className="mt-4 grid gap-4 md:grid-cols-2">
        {navigationLocale ? <input type="hidden" name={UI_LOCALE_PARAM} value={navigationLocale} /> : null}
        <input type="hidden" name="q" value={query} />
        <input type="hidden" name="page" value={page} />
        <FormField controlId="genre-source" label={t("admin.genres.slot", { slot: "A" })}>
          <Input id="genre-source" name="source" value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} ref={sourceInput} required maxLength={WORK_GENRE_MAX_LENGTH} />
        </FormField>
        <FormField controlId="genre-target" label={t("admin.genres.slot", { slot: "B" })}>
          <Input id="genre-target" name="target" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} ref={targetInput} required maxLength={WORK_GENRE_MAX_LENGTH} />
        </FormField>
        <div><Button type="submit" variant="outline">{t("admin.genres.preview")}</Button></div>
      </form>
      {source && target && previewMatches ? <div className="mt-4 grid gap-3">
        <p>{t("admin.genres.summary")}</p>
        <p>{t("admin.genres.members", { slot: "A", names: sourceMembers.map((member) => member.name).join(separator) || t("admin.genres.missing") })}</p>
        <p>{t("admin.genres.members", { slot: "B", names: targetMembers.map((member) => member.name).join(separator) || t("admin.genres.missing") })}</p>
        {canMerge ? <RedirectForm action="/api/admin/genres/merge" method="post" preserveLanguage>
          <input type="hidden" name="source_group" value={sourceMembers[0].group_id} />
          <input type="hidden" name="target_group" value={targetMembers[0].group_id} />
          <input type="hidden" name="source_snapshot" value={sourceMembers.map((member) => member.id).join(",")} />
          <input type="hidden" name="target_snapshot" value={targetMembers.map((member) => member.id).join(",")} />
          <Button type="submit">{t("admin.genres.confirm")}</Button>
        </RedirectForm> : sourceMembers.length && targetMembers.length ? <p>{t("admin.genres.same")}</p> : null}
      </div> : null}
    </details>
    <form action="/admin/genres" method="get" className="admin-filter-row">
      {navigationLocale ? <input type="hidden" name={UI_LOCALE_PARAM} value={navigationLocale} /> : null}
      <input type="hidden" name="source" value={sourceValue} />
      <input type="hidden" name="target" value={targetValue} />
      <div className="admin-field admin-field-search"><FormField controlId="genre-query" label={t("admin.genres.search")}>
        <Input id="genre-query" name="q" defaultValue={query} maxLength={WORK_GENRE_MAX_LENGTH} />
      </FormField></div>
      <Button type="submit" variant="outline">{t("admin.genres.submit")}</Button>
    </form>
    <AdminListMeta total={result.total} noun={t("admin.genres.group")} pageSize={50} />
    <ul aria-label={t("admin.genres.genres")} className="admin-panel m-0 flex list-none flex-wrap items-start gap-2">
      {result.items.map((group) => <li key={group.id} className="inline-flex min-h-7.5 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-secondary/30 px-2.75 py-1 text-sm font-medium text-secondary">
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {group.members.map((genre, index) => <Fragment key={genre.id}>
            {index ? separator : null}
            <Link to={`/games?${new URLSearchParams({ genre: genre.name })}`} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{genre.name}</Link>
          </Fragment>)}
        </span>
        <small className="shrink-0 font-mono text-[10px] font-normal tabular-nums" aria-label={t("admin.genres.publicCount", { count: formatNumber(group.publicCount, locale) })}>{formatNumber(group.publicCount, locale)}</small>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 min-h-0 rounded-full p-0 text-current hover:bg-secondary/10 hover:text-secondary [&_svg]:size-3"
          aria-label={emptySlot ? t("admin.genres.fill", { names: group.members.map((genre) => genre.name).join(separator), slot: emptySlot }) : t("admin.genres.fillDisabled")}
          title={emptySlot ? t("admin.genres.fillTitle", { slot: emptySlot }) : t("admin.genres.fillDisabled")}
          disabled={!emptySlot}
          onClick={() => fillMergeSlot(group.members[0].name)}
        ><Pencil aria-hidden /></Button>
      </li>)}
    </ul>
    <PaginationLinks basePath="/admin/genres" page={page} pageSize={50} total={result.total} params={{ q: query || undefined, source: sourceValue || undefined, target: targetValue || undefined }} />
  </main>;
}
