import { TZDateMini } from "@date-fns/tz/date/mini";
import { useLoaderData, useLocation, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { requireAdministratorPage } from "@/app/.server/auth/authorize";
import { listAdminNetplayMatches } from "@/app/.server/db/admin-netplay-matches";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { AdminListMeta, parseAdminPage, searchParam } from "@/app/admin/admin-list-controls";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { SelectField } from "@/app/components/ui/select";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { DISPLAY_TIME_ZONE, formatExactTimestamp } from "@/lib/format";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM, withoutUiLocale } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale } from "@/lib/i18n/react";
import { END_REASONS, MATCHES_PATH, endReasonLabel } from "./labels";

const PAGE_SIZE = 30;

function filterTime(value: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) return;
  const [year, month, day, hour, minute] = parts.slice(1).map(Number);
  const date = new TZDateMini(year, month - 1, day, hour, minute, DISPLAY_TIME_ZONE);
  if (!Number.isFinite(date.getTime())) return;
  const timestamp = formatExactTimestamp(date.toISOString()).slice(0, 16).replace(" ", "T");
  if (timestamp === value) return date.getTime();
}

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  await requireAdministratorPage(runtime, MATCHES_PATH);
  const { searchParams: params } = routeInput(args);
  const player = searchParam(params.q).slice(0, 80);
  const from = searchParam(params.from);
  const to = searchParam(params.to);
  const fromMs = filterTime(from);
  const toMs = filterTime(to);
  const rawReason = searchParam(params.reason);
  const reason = Object.hasOwn(END_REASONS, rawReason) ? rawReason : "";
  const result = await listAdminNetplayMatches(runtime, {
    player, from: fromMs, until: toMs === undefined ? undefined : toMs + 60_000, reason,
    page: parseAdminPage(params.page), pageSize: PAGE_SIZE,
  });
  return { player, from: fromMs === undefined ? "" : from, to: toMs === undefined ? "" : to, reason, ...result, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.netplay.matches"), translate(locale, "admin.characterIndex.console")], page: loaderData?.page }, error, locale);
};

export default function AdminNetplayMatchesPage() {
  const t = useMessages();
  const navigationLocale = useNavigationLocale();
  const { player, from, to, reason, matches, total, page } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  return (
    <main>
      <PageHeader compact title={t("admin.netplay.matches")} actions={
        <Link className={buttonVariants({ variant: "outline" })} to="/admin/netplay-spaces">{t("admin.netplay.back")}</Link>
      } />
      <form key={withoutUiLocale(search).toString()} action={MATCHES_PATH} className="admin-filters" aria-label={t("admin.netplay.filters")} method="get">
        {navigationLocale ? <input type="hidden" name={UI_LOCALE_PARAM} value={navigationLocale} /> : null}
        <div className="admin-filter-row">
          <Label className="admin-field admin-field-search">
            {t("admin.netplay.player")}
            <Input type="search" name="q" defaultValue={player} maxLength={80} placeholder={t("admin.netplay.playerHint")} />
          </Label>
          <Label className="admin-field">
            {t("admin.netplay.from")}
            <Input type="datetime-local" name="from" defaultValue={from} max={to || undefined} />
          </Label>
          <Label className="admin-field">
            {t("admin.netplay.to")}
            <Input type="datetime-local" name="to" defaultValue={to} min={from || undefined} />
          </Label>
          <Label className="admin-field">
            {t("admin.netplay.reason")}
            <SelectField aria-label={t("admin.netplay.reason")} name="reason" defaultValue={reason || "all"}
              options={[{ value: "all", label: t("admin.netplay.allReasons") }, ...Object.entries(END_REASONS).map(([value, key]) => ({ value, label: t(key) }))]} />
          </Label>
          <div className="admin-filter-actions">
            <Button type="submit">{t("admin.list.apply")}</Button>
            {player || from || to || reason ? <Link className={buttonVariants({ variant: "ghost" })} to={MATCHES_PATH}>{t("admin.list.clear")}</Link> : null}
          </div>
        </div>
      </form>
      <AdminListMeta total={total} noun={t("admin.netplay.match")} pageSize={PAGE_SIZE} />
      {matches.length ? (
        <TableWrap compact label={t("admin.netplay.matches")} minWidth={660}>
          <thead><tr><th scope="col">{t("admin.netplay.match")}</th><th scope="col">{t("admin.netplay.player")}</th><th scope="col">{t("admin.netplay.started")}</th><th scope="col">{t("admin.netplay.reason")}</th></tr></thead>
          <tbody>
            {matches.map(match => (
              <tr key={match.id}>
                <td>
                  <Link className="admin-cell-title" to={`${MATCHES_PATH}/${match.id}${search}`}>
                    {t("admin.netplay.room", { id: match.room.roomId })}
                  </Link>
                  <span className="admin-cell-meta font-mono">{match.id.slice(0, 8)}</span>
                </td>
                <td>{match.seats.map(seat => seat.display_name).join(" / ")}</td>
                <td className="whitespace-nowrap tabular-nums">{formatExactTimestamp(new Date(match.startedAt).toISOString())}</td>
                <td>{[...new Set(match.seats.map(seat => endReasonLabel(seat.end_reason, t)))].join(" / ")}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <EmptyState title={t("admin.netplay.empty")} />}
      <PaginationLinks basePath={MATCHES_PATH} page={page} pageSize={PAGE_SIZE} total={total}
        params={{ q: player || undefined, from: from || undefined, to: to || undefined, reason: reason || undefined }} />
    </main>
  );
}
