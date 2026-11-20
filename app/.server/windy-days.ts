import type { AppRuntime } from "./runtime";
import { auditRecord } from "@/lib/entity-audit";
import { formatDateKey, parseTimestamp } from "@/lib/format";

type ReportBody = {kind:string; build:string; evidence:unknown};
export function reportIndex(body: ReportBody, received: Date) {
  const evidence = auditRecord(body.evidence) ?? {};
  const attempts = Array.isArray(evidence.attempts) ? evidence.attempts : [];
  const last = auditRecord(attempts.at(-1));
  const trace = Array.isArray(last?.entries) ? auditRecord(last.entries[0]) : null;
  const entry = auditRecord(evidence.failure) ?? trace;
  const str = (v: unknown) => typeof v === "string" ? v : "";
  const stack = str(evidence.stack);
  const frame = [...stack.matchAll(/File "([^"\n]+)", line \d+, in ([^\n]+)/g)].at(-1);
  const site = frame ? frame[1].split(/[/\\]/).at(-1) + "/" + frame[2].trim() : "";
  const reason = (str(entry?.reason) || str(evidence.reason) || str(evidence.message)
    || stack.trim().split("\n").at(-1) || str(evidence.exception) || body.kind).slice(0,500);
  // Keep the rule and failing stage across builds; quoted game text and line numbers vary by incident.
  const rule = reason.split(/(?:。|；|请按配置|原文[=：(]|译文[=：])/u)[0].replace(/\d+/g,"#").slice(0,180);
  const stage = str(entry?.stage) || (trace ? (trace.processed !== trace.repaired ? "postprocess" :
    trace.repaired !== trace.restored ? "repair" : "restored" in trace ? "validate" : "transport") : "");
  const issue = JSON.stringify([body.kind,str(evidence.task),str(entry?.type),stage,str(evidence.exception),site,
    site && str(evidence.exception) ? "" : rule].map(part=>part.slice(0,180)));
  const ts = evidence.capturedAt;
  const capture = typeof ts === "number" && ts > 0 && ts*1000 <= received.getTime()+300_000 ? new Date(ts*1000) : null;
  return {day:formatDateKey(capture ?? received), occurred:capture?.toISOString() ?? null,
    build:body.build, issue, summary:reason.slice(0,240)};
}

export const windyObjectKey = (id:string) => "private/windy-errors/v1/"+id+".json";

export async function indexLegacyReports(rt: AppRuntime) {
  // Materialize metadata from pre-calendar samples once, without producing inbox notices.
  const rows = await rt.db.prepare("SELECT id,received_at FROM windy_error_reports WHERE report_day IS NULL LIMIT 30")
    .all<{id:string;received_at:string}>();
  for (const row of rows.results) {
    const object = await rt.bucket.get(windyObjectKey(row.id));
    if (!object) throw new Response(null,{status:503});
    const index = reportIndex(await object.json<ReportBody>(),parseTimestamp(row.received_at));
    await rt.db.prepare("UPDATE windy_error_reports SET report_day=?,occurred_at=?,build_id=?,issue_key=?,issue_summary=? WHERE id=? AND report_day IS NULL")
      .bind(index.day,index.occurred,index.build,index.issue,index.summary,row.id).run();
  }
  return rows.results.length;
}

export function dayFilter(url: URL) {
  const day = url.searchParams.get("day") ?? formatDateKey(new Date());
  const date = new Date(day+"T00:00:00Z");
  if (!/^\d{4}-\d\d-\d\d$/.test(day) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==day)
    throw new Response(null,{status:400});
  const build = url.searchParams.get("build") ?? "";
  return {day,build};
}

export type DaySample = {
  id:string; kind:string; report_day:string; occurred_at:string|null; received_at:string; version:string;
  build_id:string; occurrences:number; issue_summary:string; issue_key:string; first_day:string; first_build:string;
};
export const dayRows = `SELECT r.id,r.kind,r.report_day,r.occurred_at,r.received_at,r.version,r.build_id,r.occurrences,r.issue_summary,r.issue_key,
    (SELECT min(prior.report_day) FROM windy_error_reports prior WHERE prior.issue_key=r.issue_key) AS first_day,
    (SELECT coalesce(nullif(prior.build_id,''),prior.version) FROM windy_error_reports prior WHERE prior.issue_key=r.issue_key
       ORDER BY prior.report_day,coalesce(prior.occurred_at,replace(prior.received_at,' ','T')),prior.id LIMIT 1) AS first_build
  FROM windy_error_reports r WHERE r.report_day=? AND (?='' OR coalesce(nullif(r.build_id,''),r.version)=?)`;
