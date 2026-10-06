import { getD1 } from "@/app/.server/db/d1";
import type { AppRuntime } from "@/app/.server/runtime";
import { AUDIT_REPORT_MAX_LOGS } from "@/lib/audit-report-config.mjs";
import { DailyAuditAnalyzer, auditReportWindow, previousAuditDate,
  type AuditReportLog, type DailyAuditReport, type DailyAuditSummary } from "@/lib/audit-report";

type ReportRow = { report_date: string; status: DailyAuditReport["status"]; generated_at: string; summary_json: string | null };

export async function listDailyAuditReports(runtime: AppRuntime, reportDate?: string) {
  const database = getD1(runtime);
  const dates = await database.prepare("SELECT report_date,status FROM audit_daily_reports ORDER BY report_date DESC LIMIT 90")
    .all<{ report_date: string; status: DailyAuditReport["status"] }>();
  const selectedDate = reportDate || dates.results?.[0]?.report_date;
  const row = selectedDate ? await database.prepare("SELECT report_date,status,generated_at,summary_json FROM audit_daily_reports WHERE report_date=?")
    .bind(selectedDate).first<ReportRow>() : null;
  const report: DailyAuditReport | null = row ? { reportDate: row.report_date, status: row.status,
    generatedAt: row.generated_at, summary: row.summary_json ? JSON.parse(row.summary_json) as DailyAuditSummary : null } : null;
  return { dates: (dates.results ?? []).map((date) => ({ reportDate: date.report_date, status: date.status })), report,
    expectedDate: previousAuditDate(Date.now() - 9 * 3600_000) };
}

export async function generateDailyAuditReport(database: D1Database, reportDate: string) {
  const window = auditReportWindow(reportDate);
  // Freeze the upper ID so later audit insertions cannot change the scan's count.
  const scope = await database.prepare(`SELECT COUNT(*) AS count,COALESCE(MIN(id),1) AS min_id,COALESCE(MAX(id),0) AS max_id FROM auth_audit_logs
    WHERE datetime(created_at)>=? AND datetime(created_at)<?`).bind(window.start, window.end)
    .first<{ count: number; min_id: number; max_id: number }>();
  if (!scope) throw new Error("Audit scope could not be read");
  const analyzer = new DailyAuditAnalyzer(reportDate, scope.count, scope.max_id);
  let lastId = scope.min_id - 1;
  while (analyzer.summary.scannedLogs < Math.min(scope.count, AUDIT_REPORT_MAX_LOGS)) {
    const rows = await database.prepare(`SELECT a.id,a.user_id,u.display_name AS actor_name,a.event_type,a.detail_json
      FROM auth_audit_logs a LEFT JOIN users u ON u.id=a.user_id
      WHERE datetime(a.created_at)>=? AND datetime(a.created_at)<? AND a.id>? AND a.id<=?
      ORDER BY a.id LIMIT ?`).bind(window.start, window.end, lastId, scope.max_id,
        Math.min(100, AUDIT_REPORT_MAX_LOGS - analyzer.summary.scannedLogs)).all<AuditReportLog>();
    if (!rows.results?.length) break;
    for (const row of rows.results) { analyzer.consume(row); lastId = row.id; }
  }
  const summary = analyzer.finish();
  const status = summary.scannedLogs === summary.totalLogs && !summary.incompleteEdits ? "complete" : "incomplete";
  await database.prepare(`INSERT INTO audit_daily_reports(report_date,status,summary_json,generated_at)
    VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(report_date) DO UPDATE SET
    status=excluded.status,summary_json=excluded.summary_json,generated_at=excluded.generated_at`)
    .bind(reportDate, status, JSON.stringify(summary)).run();
  return { reportDate, status, totalLogs: summary.totalLogs, entityEdits: summary.entityEdits };
}

export async function runScheduledAuditReports(database: D1Database, scheduledTime: number) {
  const yesterday = previousAuditDate(scheduledTime);
  const latest = await database.prepare("SELECT MAX(report_date) AS date FROM audit_daily_reports").first<{ date: string | null }>();
  const failed = await database.prepare("SELECT report_date FROM audit_daily_reports WHERE status='failed' AND report_date<=? ORDER BY datetime(generated_at),report_date LIMIT 3")
    .bind(yesterday).all<{ report_date: string }>();
  const dates = new Set((failed.results ?? []).map((row) => row.report_date));
  let next = latest?.date ? nextDate(latest.date) : yesterday;
  while (next <= yesterday && dates.size < 7) { dates.add(next); next = nextDate(next); }
  // Repeated delivery of the same scheduled event is harmless.
  if (!dates.size) return;
  let failedCount = 0;
  for (const date of [...dates].sort()) {
    try { console.log("Daily audit report saved", await generateDailyAuditReport(database, date)); }
    catch (error) {
      failedCount++;
      console.error("Daily audit report failed", date, error);
      await database.prepare(`INSERT INTO audit_daily_reports(report_date,status,summary_json,generated_at)
        VALUES(?,'failed',NULL,CURRENT_TIMESTAMP) ON CONFLICT(report_date) DO UPDATE SET
        status='failed',summary_json=NULL,generated_at=excluded.generated_at
        WHERE audit_daily_reports.status='failed'`).bind(date).run();
    }
  }
  // Surface failure in Cron execution history as well as in the admin report.
  if (failedCount) throw new Error(`${failedCount} daily audit reports failed`);
}

function nextDate(date: string) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400_000).toISOString().slice(0, 10);
}
