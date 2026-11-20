import type { AppRuntime } from "./runtime";
import { readJsonObject } from "./http/request";
import { enqueueWebPush } from "./push/service";
import { reportIndex, windyObjectKey as objectKey } from "./windy-days";

const reportId = /^[a-f0-9]{32}$/;

export async function ingestWindyReport(rt: AppRuntime) {
  // Reuse provisioned limits with isolated keys. Reject before storage or notification work.
  if ((rt.env as CloudflareEnv & { WINDY_REPORTS_PAUSED?: string }).WINDY_REPORTS_PAUSED === "true")
    return new Response(null, {status: 503, headers: {"Retry-After": "3600"}});
  const ip = rt.request.headers.get("cf-connecting-ip") || "local";
  for (const [limiter,key] of [[rt.env.AUTH_EMAIL_RATE_LIMITER, "windy:" + ip],
    [rt.env.VIEW_RATE_LIMITER, "windy:ingest"]] as const) {
    if (!(await limiter.limit({key})).success)
      return new Response(null, {status: 429, headers: {"Retry-After": "60"}});
  }
  const body = await readJsonObject(rt.request, "Invalid error report", {maximumBytes: 512 * 1024, requireJsonContentType: true});
  const {id,kind,version,build,occurrences,evidence} = body;
  if (body.schema !== 1 || typeof id !== "string" || !reportId.test(id)
    || typeof kind !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(kind) || typeof version !== "string" || !version || version.length > 100
    || typeof build !== "string" || build.length > 160 || typeof occurrences !== "number"
    || !Number.isSafeInteger(occurrences) || occurrences < 1 || occurrences > 1000000
    || !evidence || typeof evidence !== "object" || Array.isArray(evidence))
    return new Response(null, {status: 400});
  const exists = rt.db.prepare("SELECT kind,occurrences FROM windy_error_reports WHERE id=?").bind(id);
  const previous = await exists.first<{kind:string;occurrences:number}>();
  if (previous) {
    if (kind !== previous.kind) return new Response(null,{status:400});
    if (occurrences > previous.occurrences) {
      // Both updates see the same current count; retried or out-of-order summaries add no duplicates.
      await rt.db.batch([
        rt.db.prepare("UPDATE windy_error_groups SET occurrences=occurrences+max(0,?-(SELECT occurrences FROM windy_error_reports WHERE id=?)),last_seen=CURRENT_TIMESTAMP WHERE kind=?")
          .bind(occurrences,id,kind),
        rt.db.prepare("UPDATE windy_error_reports SET occurrences=max(occurrences,?) WHERE id=?").bind(occurrences,id),
      ]);
    }
    return new Response(null, {status: 204});
  }
  if (Object.keys(evidence).length === 0) return new Response(null, {status: 400});
  const payload = {schema: 1,id,kind,version,build,occurrences,evidence};
  const key = objectKey(id);
  const stored = await rt.bucket.put(key, JSON.stringify(payload), {onlyIf: {etagDoesNotMatch: "*"},
    httpMetadata: {contentType: "application/json", cacheControl: "private, no-store"}});
  // If a previous call stored the object but lost the D1 acknowledgement, index the original.
  const record = stored ? payload : await (await rt.bucket.get(key))?.json<typeof payload>();
  if (!record) return new Response(null, {status: 503});
  const buildNumber = Number(/^windy:[0-9a-f]{7,64}:(\d{1,14})\.\d+$/i.exec(record.build)?.[1] ?? 0);
  const index = reportIndex(record,new Date());
  const result = await rt.db.batch([
    rt.db.prepare("INSERT INTO windy_error_groups(kind) VALUES(?) ON CONFLICT DO NOTHING").bind(record.kind),
    rt.db.prepare("INSERT INTO windy_error_reports(id,kind,version,build_number,occurrences,report_day,occurred_at,build_id,issue_key,issue_summary) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING")
      .bind(id,record.kind,record.version,buildNumber,record.occurrences,index.day,index.occurred,index.build,index.issue,index.summary),
  ]);
  if (result[1].meta.changes) rt.execution.waitUntil(enqueueWebPush(rt.env).catch(() => console.error("Windy notice push failed")));
  return new Response(null, {status: 204});
}

export async function getWindyEvidence(rt: AppRuntime, id: string) {
  if (!reportId.test(id)) return null;
  return (await rt.bucket.get(objectKey(id)))?.text();
}
