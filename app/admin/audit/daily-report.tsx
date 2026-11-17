import { isMessageKey } from "@/lib/i18n/core";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";
import { Badge } from "@/app/components/ui/badge";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { ChipList } from "@/app/components/ui/chip-list";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Label } from "@/app/components/ui/label";
import { Pane } from "@/app/components/ui/pane";
import { SelectField } from "@/app/components/ui/select";
import { StatList } from "@/app/components/ui/stat-list";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { entityAuditTargetHref } from "@/lib/entity-audit";
import type { DailyAuditReport } from "@/lib/audit-report";
import { formatDate } from "@/lib/format";

export function DailyAuditReportPane({ dates, report, expectedDate }: {
  dates: { reportDate: string; status: DailyAuditReport["status"] }[];
  report: DailyAuditReport | null;
  expectedDate: string;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const navigationLocale = useNavigationLocale();
  const summary = report?.summary;
  const targetLabel = summary?.version === 2 ? t("admin.auditDaily.changedTargets") : t("admin.auditDaily.affectedTargets");
  const latestDate = dates[0]?.reportDate;
  const findingCount = summary ? Object.values(summary.findingCounts).reduce((sum, count) => sum + (count ?? 0), 0) : 0;
  return (
    <Pane heading={t("admin.auditDaily.title")}>
      <div className="grid min-w-0 gap-5">
        <p className="text-sm leading-relaxed text-muted">{t("admin.auditDaily.schedule")}</p>
        {!latestDate || latestDate < expectedDate ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm leading-relaxed text-danger">
            {t("admin.auditDaily.missing", { date: expectedDate })}
          </p>
        ) : null}

        <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
          {dates.length ? (
            <form action="/admin/audit" method="get" className="flex min-w-0 flex-wrap items-end gap-3" aria-label={t("admin.auditDaily.choose")}>
              {navigationLocale ? <input type="hidden" name={UI_LOCALE_PARAM} value={navigationLocale} /> : null}
              <Label className="grid min-w-0 gap-2 text-xs font-medium text-muted">
                {t("admin.auditDaily.date")}
                <SelectField aria-label={t("admin.auditDaily.date")} name="reportDate" defaultValue={report?.reportDate ?? latestDate}
                  key={report?.reportDate ?? latestDate}
                  options={dates.map((date) => ({ value: date.reportDate, label: t("admin.auditDaily.option", { date: date.reportDate, status: t(`admin.auditDaily.status.${date.status}`) }) }))} />
              </Label>
              <Button type="submit">{t("admin.auditDaily.view")}</Button>
            </form>
          ) : <EmptyState title={t("admin.auditDaily.empty")} />}
          {report ? (
            <a className={buttonVariants({ variant: "neutral" })}
              href={`/api/admin/audit/reports/${report.reportDate}/export`} download={`viprpg-audit-${report.reportDate}.jsonl`}>{t("admin.auditDaily.export")}</a>
          ) : null}
        </div>

        {report ? (
          <div className="grid min-w-0 gap-5">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span className="font-medium text-foreground">{report.reportDate}</span>
              <Badge variant={report.status === "failed" ? "negative" : report.status === "incomplete" ? "pending" : "neutral"}>{t(`admin.auditDaily.status.${report.status}`)}</Badge>
              <span>{t("admin.auditDaily.generated", { date: formatDate(report.generatedAt, { locale }) })}</span>
            </div>
            {report.status === "failed" ? <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm leading-relaxed text-danger">{t("admin.auditDaily.generationFailed")}</p> : null}

            {summary ? (
              <>
                <div className="[&_dd]:text-xl [&_dd]:tabular-nums">
                  <StatList variant="tiles" columns={3} items={[
                    { label: t("admin.audit.title"), value: <>{summary.totalLogs.toLocaleString(locale)}<p className="mt-1 text-xs font-normal text-muted">{t("admin.auditDaily.scanned", { count: summary.scannedLogs })}</p></> },
                    { label: t("admin.auditDaily.edits"), value: <>{summary.entityEdits.toLocaleString(locale)}<p className="mt-1 text-xs font-normal text-muted">{t("admin.auditDaily.changed", { count: summary.changedFields })}</p></> },
                    { label: t("admin.auditDaily.traceable"), value: summary.completeSnapshots.toLocaleString(locale) },
                    { label: t("admin.auditDaily.finding.coverage"), value: summary.incompleteEdits.toLocaleString(locale) },
                    { label: t("admin.auditDaily.authorization"), value: summary.authorizationChanges.toLocaleString(locale) },
                    { label: t("admin.auditDaily.review"), value: findingCount.toLocaleString(locale) },
                  ]} />
                </div>

                <div className="grid gap-2 rounded-md border border-border bg-muted/10 p-4 text-sm leading-relaxed">
                  <p className={`font-semibold ${report.status === "incomplete" ? "text-danger" : ""}`}>{report.status === "incomplete"
                    ? t("admin.auditDaily.incomplete")
                    : findingCount ? t("admin.auditDaily.found", { count: findingCount }) : t("admin.auditDaily.noHits")}</p>
                  <p className="text-xs text-muted">{t("admin.auditDaily.reviewRule")}</p>
                  {summary.version === 1 ? <p className="text-xs text-muted">{t("admin.auditDaily.legacy")}</p> : null}
                  {summary.scannedLogs < summary.totalLogs ? <p className="text-danger">{t("admin.auditDaily.scanLimit")}</p> : null}
                </div>

                <div className="grid gap-2">
                  <h3 className="text-xs font-medium text-muted">{targetLabel}</h3>
                  {Object.values(summary.targetCounts).some((count) => count > 0) ? (
                    <ChipList items={Object.entries(summary.targetCounts).filter(([, count]) => count > 0).map(([type, count]) => ({
                      label: t("admin.auditDaily.chip", { label: auditCountLabel(t, "target", type), count }),
                    }))} />
                  ) : <p className="text-sm text-muted">{t("admin.auditDaily.noTargets")}</p>}
                </div>

                {findingCount ? <ChipList items={Object.entries(summary.findingCounts).filter(([, count]) => count && count > 0).map(([kind, count]) => ({
                  label: t("admin.auditDaily.chip", { label: auditCountLabel(t, "finding", kind), count: count ?? 0 }),
                }))} /> : null}

                {summary.findings.length ? (
                  <details className="admin-details">
                    <summary>{t("admin.auditDaily.reviewCount", { count: findingCount })}</summary>
                    <ol className="mt-4 min-w-0 divide-y divide-border">
                      {summary.findings.map((finding, index) => (
                        <li className="grid min-w-0 gap-3 py-4 first:pt-0 last:pb-0" key={index}>
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            <Badge variant="neutral">{t(`admin.auditDaily.finding.${finding.kind}`)}</Badge>
                            <span className="min-w-0 wrap-anywhere font-medium">{finding.actorName}{finding.actorUserId ? <span className="ml-2 font-mono text-xs text-muted">#{finding.actorUserId}</span> : null}</span>
                          </div>
                          <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">{finding.message}</p>
                          {finding.targets.length ? (
                            <ul className="grid gap-1 text-xs">
                              {finding.targets.map((target) => (
                                <li className="min-w-0 wrap-anywhere" key={`${target.type}:${target.id}`}>
                                  <Link className="text-primary hover:underline" to={entityAuditTargetHref(target)}>{t(`admin.audit.target.${target.type}`)} {target.name ?? ""} #{target.id}</Link>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2 text-xs">
                            <span className="text-muted">{t("admin.auditDaily.original")}</span>
                            <ul className="flex min-w-0 flex-wrap gap-x-3 gap-y-2">
                              {finding.logIds.map((id) => (
                                <li key={id}><Link className="font-mono text-primary hover:underline" to={`/admin/audit?logId=${id}#audit-log-${id}`}>#{id}</Link></li>
                              ))}
                            </ul>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}
                {summary.omittedFindings ? <p className="text-xs leading-relaxed text-muted">{t("admin.auditDaily.omitted", { count: summary.omittedFindings })}</p> : null}

                {summary.actors.length ? (
                  <details className="admin-details">
                    <summary>{t("admin.auditDaily.actorCount", { count: summary.actors.length })}</summary>
                    <TableWrap compact label={t("admin.auditDaily.actorSummary")} minWidth={600}>
                      <thead><tr><th>{t("admin.audit.actor")}</th><th>{t("admin.auditDaily.editCount")}</th><th>{targetLabel}</th><th>{t("admin.auditDaily.records")}</th></tr></thead>
                      <tbody>{summary.actors.map((actor, index) => <tr key={`${actor.userId}:${index}`}>
                        <td>{actor.name}{actor.userId ? <span className="admin-cell-meta font-mono">#{actor.userId}</span> : null}</td>
                        <td className="tabular-nums">{actor.edits.toLocaleString(locale)}</td><td className="tabular-nums">{actor.targets.toLocaleString(locale)}</td>
                        <td>{actor.userId ? <Link className="text-primary hover:underline" to={`/admin/audit?q=${actor.userId}`}>{t("admin.auditDaily.actorLogs")}</Link> : t("admin.auditDaily.unrecorded")}</td>
                      </tr>)}</tbody>
                    </TableWrap>
                  </details>
                ) : null}
              </>
            ) : null}
            <p className="text-xs leading-relaxed text-muted">{t("admin.auditDaily.exportNote")}</p>
          </div>
        ) : dates.length ? <p className="text-sm text-muted">{t("admin.auditDaily.noReport")}</p> : null}

        <details className="admin-details">
          <summary>{t("admin.auditDaily.rules")}</summary>
          <div className="mt-3 grid gap-3 text-sm leading-relaxed text-muted">
            <p>{t("admin.auditDaily.rulesThreshold")}</p>
            <p>{t("admin.auditDaily.rulesScope")}</p>
            <p>{t("admin.auditDaily.rulesLimit")}</p>
          </div>
        </details>
      </div>
    </Pane>
  );
}

function auditCountLabel(t: ReturnType<typeof useMessages>, group: "target" | "finding", value: string) {
  const key = group === "target" ? `admin.audit.target.${value}` : `admin.auditDaily.finding.${value}`;
  return isMessageKey(key) ? t(key) : value;
}
