import { requirePagePermission } from "@/app/.server/auth/authorize";
import {
  listAdminRoleEvents,
  searchAdminAuditLogs,
} from "@/app/.server/db/admin-audit";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { parseAdminPage, searchParam } from "@/app/admin/admin-list-controls";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { SelectField } from "@/app/components/ui/select";
import { AUDIT_TARGET_LABELS, auditRecord, entityAuditChanges, entityAuditTargets, entityAuditTargetHref } from "@/lib/entity-audit";
import { isPermissionKey } from "@/lib/authz/permissions";
import { formatDate } from "@/lib/format";
import { listDailyAuditReports } from "@/app/.server/db/audit-reports";
import { DailyAuditReportPane } from "@/app/admin/audit/daily-report";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";
import { useLoaderData } from "react-router";

const PAGE_SIZE = 50;

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { searchParams } = routeInput(args);

  await requirePagePermission(runtime, "/admin/audit", "audit.read");
  const params = await searchParams;
  const query = searchParam(params.q);
  const eventType = searchParam(params.action);
  const rawTargetType = searchParam(params.targetType);
  const targetType = Object.hasOwn(AUDIT_TARGET_LABELS, rawTargetType) ? rawTargetType : "";
  const targetId = searchParam(params.targetId);
  const logIdText = searchParam(params.logId);
  const logId = /^\d+$/.test(logIdText) && Number.isSafeInteger(Number(logIdText)) && Number(logIdText) > 0 ? Number(logIdText) : undefined;
  const reportDate = searchParam(params.reportDate);
  const page = parseAdminPage(params.page);
  const [auditResult, roleEvents, dailyReports] = await Promise.all([
    searchAdminAuditLogs(runtime, {
      query,
      eventType,
      targetType,
      targetId,
      logId,
      page,
      pageSize: PAGE_SIZE,
    }),
    listAdminRoleEvents(runtime, 100),
    listDailyAuditReports(runtime, reportDate),
  ]);

  return { query, eventType, targetType, targetId, logId, page, auditResult, roleEvents, dailyReports, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.audit.title"), translate(locale, "admin.characterIndex.console")], page: loaderData?.page }, error, locale);
};

export default function AdminAuditPage() {
  const t = useMessages();
  const locale = useUiLocale();
  const navigationLocale = useNavigationLocale();
  const { query, eventType, targetType, targetId, logId, page, auditResult, roleEvents, dailyReports } =
    useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title={t("admin.audit.title")}
        subtitle={t("admin.audit.subtitle")}
      />

      <DailyAuditReportPane {...dailyReports} />

      <Pane heading={t("admin.audit.systemLogs")}>
        <div className="grid min-w-0 gap-5">
          <form
            key={JSON.stringify([query, eventType, targetType, targetId])}
            action="/admin/audit"
            className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr]"
            aria-label={t("admin.audit.filters")}
            method="get"
          >
            {navigationLocale ? <input type="hidden" name={UI_LOCALE_PARAM} value={navigationLocale} /> : null}
            <Label className="admin-field">
              {t("admin.audit.actor")}
              <Input
                defaultValue={query}
                name="q"
                placeholder={t("admin.audit.actorHint")}
              />
            </Label>
            <Label className="admin-field">
              {t("admin.audit.action")}
              <Input
                defaultValue={eventType}
                name="action"
                placeholder={t("admin.audit.event")}
              />
            </Label>
            <Label className="admin-field">
              {t("admin.audit.targetType")}
              <SelectField aria-label={t("admin.audit.targetType")} name="targetType" defaultValue={targetType}
                options={[{ value: "", label: t("admin.audit.allTypes") }, ...(Object.keys(AUDIT_TARGET_LABELS) as (keyof typeof AUDIT_TARGET_LABELS)[]).map((value) => ({ value, label: t(`admin.audit.target.${value}`) }))]} />
            </Label>
            <Label className="admin-field">
              {t("admin.audit.targetId")}
              <Input name="targetId" defaultValue={targetId} placeholder={t("admin.audit.targetHint")} />
            </Label>
            <div className="admin-filter-actions sm:col-span-2 xl:col-span-4">
              <Button type="submit">{t("admin.list.apply")}</Button>
              {query || eventType || targetType || targetId || logId ? (
                <Link className={buttonVariants({ variant: "ghost" })} to="/admin/audit">
                  {t("admin.list.clear")}
                </Link>
              ) : null}
            </div>
          </form>
          <div className="admin-list-meta">
            <span>
              {logId ? t("admin.audit.logId", { id: logId }) : ""}
              {t("admin.audit.total", { count: auditResult.total })}
            </span>
            <span>{t("admin.audit.pageSize", { count: PAGE_SIZE })}</span>
          </div>

          {auditResult.items.length > 0 ? (
            <ol className="min-w-0 divide-y divide-border border-t border-border">
              {auditResult.items.map((log) => (
                <li key={log.id} id={`audit-log-${log.id}`} className="grid min-w-0 scroll-mt-6 gap-4 py-5 last:pb-0 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6">
                  <div className="grid min-w-0 content-start gap-3">
                    <div className="grid min-w-0 gap-1">
                      <h3 className="m-0 wrap-anywhere font-mono text-sm font-semibold text-primary">{log.eventType}</h3>
                      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                        <span className="font-mono">#{log.id}</span>
                        <span>{formatDate(log.createdAt, { locale })}</span>
                      </p>
                    </div>
                    <div className="min-w-0 wrap-anywhere text-sm">
                      <p className="mb-1 text-xs text-muted">{t("admin.audit.actor")}</p>
                      <p className="font-medium">
                        {String(auditRecord(auditRecord(log.detail)?.actor)?.displayName ?? log.actorName ?? log.email ?? t("admin.audit.system"))}
                        {log.userId ? <span className="ml-2 font-mono text-xs text-muted">#{log.userId}</span> : null}
                      </p>
                      {log.email ? <p className="mt-1 text-xs text-muted">{log.email}</p> : null}
                    </div>
                  </div>
                  <AuditDetail detail={log.detail} />
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title={t("admin.audit.empty")} />
          )}
          <PaginationLinks
            className="my-0"
            basePath="/admin/audit"
            page={page}
            pageSize={PAGE_SIZE}
            total={auditResult.total}
            params={{ q: query || undefined, action: eventType || undefined, targetType: targetType || undefined, targetId: targetId || undefined, logId: logId ? String(logId) : undefined }}
          />
        </div>
      </Pane>

      <details className="admin-panel admin-details">
        <summary>{t("admin.audit.roleCount", { count: roleEvents.length })}</summary>
        {roleEvents.length > 0 ? (
          <TableWrap compact label={t("admin.audit.roleEvents")} minWidth={980}>
            <thead>
              <tr>
                <th>{t("admin.archives.time")}</th>
                <th>{t("admin.audit.actor")}</th>
                <th>{t("admin.audit.targetUser")}</th>
                <th>{t("admin.audit.change")}</th>
                <th>{t("admin.audit.source")}</th>
              </tr>
            </thead>
            <tbody>
              {roleEvents.map((event) => (
                <tr key={event.id}>
                  <td>{formatDate(event.createdAt, { locale })}</td>
                  <td>
                    {event.actorName ?? t("admin.audit.system")}
                    {event.actorUserId ? (
                      <span className="admin-cell-meta font-mono">
                        #{event.actorUserId}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {event.targetName ?? t("admin.audit.unknownUser")}
                    <span className="admin-cell-meta font-mono">
                      #{event.targetUserId}
                    </span>
                  </td>
                  <td>
                    {event.action === "assigned" ? t("admin.audit.assigned") : t("admin.audit.removed")}{" "}
                    {event.role.name}
                    {event.reason ? (
                      <span className="admin-cell-meta whitespace-pre-wrap wrap-anywhere">{event.reason}</span>
                    ) : null}
                  </td>
                  <td>
                    {event.sourceInboxItemId ? (
                      <span className="font-mono text-sm text-primary">
                        {t("admin.audit.inbox", { id: event.sourceInboxItemId })}
                      </span>
                    ) : (
                      t("admin.audit.direct")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState title={t("admin.audit.emptyRoles")} />
        )}
      </details>
    </main>
  );
}

function AuditDetail({ detail }: { detail: unknown }) {
  const t = useMessages();
  const data = auditRecord(detail);
  const targets = entityAuditTargets(detail);
  const hasSnapshots = data && Object.hasOwn(data, "before") && Object.hasOwn(data, "after");
  const changes = hasSnapshots ? entityAuditChanges(data.before, data.after) : [];
  const authorization = auditRecord(data?.authorization);
  const actor = auditRecord(data?.actor);
  const permission = typeof authorization?.permission === "string" ? authorization.permission : null;
  const permissionLabel = isPermissionKey(permission) ? t(`permission.${permission}`) : permission;
  return <div className="grid min-w-0 content-start gap-3">
    {targets.length ? <ul className="grid gap-2 text-sm">
      {targets.map((target) => <li className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1" key={`${target.type}:${target.id}`}>
        <Link className="min-w-0 wrap-anywhere text-primary hover:underline" to={entityAuditTargetHref(target)}>
          {t(`admin.audit.target.${target.type}`)} {target.name ?? ""} <span className="font-mono">#{target.id}</span>
        </Link>
        <Link className="shrink-0 text-xs text-muted hover:underline" to={`/admin/audit?targetType=${target.type}&targetId=${encodeURIComponent(String(target.id))}`}>{t("admin.audit.history")}</Link>
      </li>)}
    </ul> : null}
    {!hasSnapshots && targets.length ?
      <p className="text-sm text-muted">{t("admin.audit.noSnapshots")}</p> : null}
    <details className="admin-details">
      <summary>{hasSnapshots ? t("admin.audit.changeCount", { count: changes.length }) : t("admin.audit.detail")}</summary>
      <div className="mt-4 grid min-w-0 gap-4">
        {authorization ? <dl className="grid gap-3 rounded-md bg-muted/10 p-3 text-sm sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-xs text-muted">{t("admin.audit.rolesAtAction")}</dt><dd className="mt-1 wrap-anywhere">{Array.isArray(actor?.roleNames) ? actor.roleNames.join("、") || t("admin.audit.noRoles") : t("admin.audit.unrecorded")}</dd></div>
          <div className="min-w-0"><dt className="text-xs text-muted">{t("admin.audit.authorization")}</dt><dd className="mt-1 wrap-anywhere">{authorization.basis === "content_author" ? t("admin.audit.contentAuthor") : authorization.basis === "work_maintainer" ? t("admin.audit.maintainer") : permissionLabel ?? t("admin.audit.unrecorded")}</dd></div>
          {data?.source ? <div className="min-w-0"><dt className="text-xs text-muted">{t("admin.audit.entry")}</dt><dd className="mt-1">{data.source === "admin" ? t("admin.audit.admin") : data.source === "owned" ? t("admin.audit.owned") : t("admin.audit.frontend")}</dd></div> : null}
        </dl> : null}
        {hasSnapshots ? (changes.length ? <ul className="grid min-w-0 gap-4">
          {changes.map((change, index) => <li className="min-w-0 rounded-md border border-border p-3" key={`${change.field}:${index}`}>
            <h4 className="mb-3 wrap-anywhere text-sm font-semibold">{change.field}</h4>
            <dl className="grid min-w-0 gap-4 md:grid-cols-2">
              <div className="min-w-0"><dt className="mb-2 text-xs text-muted">{t("admin.audit.before")}</dt><dd><pre className="whitespace-pre-wrap wrap-anywhere rounded bg-muted/10 p-3 font-mono text-xs leading-relaxed">{formatDetail(change.before, t)}</pre></dd></div>
              <div className="min-w-0"><dt className="mb-2 text-xs text-muted">{t("admin.audit.after")}</dt><dd><pre className="whitespace-pre-wrap wrap-anywhere rounded bg-primary/5 p-3 font-mono text-xs leading-relaxed">{formatDetail(change.after, t)}</pre></dd></div>
            </dl>
          </li>)}
        </ul> : <p className="text-sm text-muted">{t("admin.audit.noChanges")}</p>) : null}
        <details className="admin-details"><summary>{t("admin.audit.raw")}</summary>
          <pre className="mt-3 min-w-0 whitespace-pre-wrap wrap-anywhere rounded-md border border-border bg-muted/10 p-3 font-mono text-xs leading-relaxed">{formatDetail(detail, t)}</pre>
        </details>
      </div>
    </details>
  </div>;
}

function formatDetail(value: unknown, t: ReturnType<typeof useMessages>): string {
  if (value === undefined) return t("admin.audit.undefined");
  if (value === null) return t("admin.audit.null");

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}
