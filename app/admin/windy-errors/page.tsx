import { data, Form, useLoaderData, useSearchParams, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { useMemo } from "react";
import { ChevronRight, Download } from "lucide-react";
import { Badge } from "@/app/components/ui/badge";
import { EmptyState } from "@/app/components/ui/empty-state";
import { SelectField } from "@/app/components/ui/select";
import { auditRecord } from "@/lib/entity-audit";
import { formatDate } from "@/lib/format";
import { isMessageKey, translate } from "@/lib/i18n/core";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { runtimeContext } from "@/app/.server/router-context";
import { requireBootstrapAdmin, requireBootstrapAdminPage } from "@/app/.server/auth/authorize";
import { getWindyEvidence } from "@/app/.server/windy-reports";
import { PageHeader } from "@/app/components/ui/page-header";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useMessages, useUiLocale } from "@/lib/i18n/react";

const base = "/admin/windy-errors/detail";
const noStore = {"Cache-Control": "private, no-store"};
export const headers = () => noStore;
type Group = {kind: string; occurrences: number; samples: number; first_seen: string; last_seen: string; fixed_build: number | null};
type Sample = {id: string; version: string; received_at: string; occurrences: number; build_number: number};
export async function loader({request,context}: LoaderFunctionArgs) {
  const rt=context.get(runtimeContext);
  await requireBootstrapAdminPage(rt, base);
  const query=new URL(request.url).searchParams;
  const groups=(await rt.db.prepare("SELECT * FROM windy_error_groups ORDER BY last_seen DESC,kind").all<Group>()).results;
  const group=groups.find(g=>g.kind===query.get("kind")) ?? groups[0];
  const page=Math.max(0,Math.min(Math.ceil((group?.samples ?? 0)/30)-1,Number(query.get("page")) || 0));
  const samples=group ? (await rt.db.prepare("SELECT * FROM windy_error_reports WHERE kind=? ORDER BY received_at DESC,id DESC LIMIT 30 OFFSET ?")
    .bind(group.kind,Math.floor(page)*30).all<Sample>()).results : [];
  const sampleId=query.get("sample");
  const selected=sampleId && group ? await rt.db.prepare("SELECT * FROM windy_error_reports WHERE id=? AND kind=?")
    .bind(sampleId,group.kind).first<Sample>() : samples[0];
  if (sampleId && !selected) throw new Response(null,{status:404});
  const raw=selected ? await getWindyEvidence(rt,selected.id) : null;
  if (selected && !raw) throw new Response(null,{status:503});
  return data({groups,group,samples,selected,raw,page,locale:rt.uiLocale}, {headers:noStore});
}
export async function action({request,context}: ActionFunctionArgs) {
  const rt=context.get(runtimeContext);
  const auth=await requireBootstrapAdmin(rt,request);
  if ("response" in auth) return auth.response;
  const form=await request.formData();
  const build=Number(form.get("build"));
  if (!Number.isSafeInteger(build) || build<=0) throw new Response(null,{status:400});
  await rt.db.prepare("UPDATE windy_error_groups SET fixed_build=? WHERE kind=?").bind(build,String(form.get("kind"))).run();
  return null;
}
function ChangedLine({ before, after }: { before: string; after: string }) {
  const a = Array.from(before), b = Array.from(after);
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return <>{b.slice(0, start).join("")}<mark className="rounded-sm bg-destructive/15 font-bold text-destructive">{b.slice(start, b.length - end).join("")}</mark>{b.slice(b.length - end).join("")}</>;
}

function TextPanel({ label, value, compare }: { label: string; value: string; compare?: string }) {
  const previous = compare?.split("\n");
  return <section className="min-w-0 overflow-hidden rounded-lg border border-border">
    <h4 className="border-b border-border bg-muted/10 px-3 py-2 text-xs font-semibold">{label}</h4>
    <div className="max-h-72 overflow-auto py-2 font-mono text-sm">
      {value.split("\n").map((line, i) => <div key={i} className="grid grid-cols-[2.2rem_minmax(0,1fr)] px-1">
        <span aria-hidden className="select-none pr-2 text-end text-xs leading-6 text-muted">{i + 1}</span>
        <code className="min-w-0 whitespace-pre-wrap break-all pr-2 leading-6">{previous && previous[i] !== line
          ? <ChangedLine before={previous[i] ?? ""} after={line} /> : line}</code>
      </div>)}
    </div>
  </section>;
}

const stageKeys = {
  original: "windy.original", raw: "windy.rawText", restored: "windy.restored",
  repaired: "windy.repaired", processed: "windy.processed",
} as const;

function EntryEvidence({ entry, kind }: { entry: Record<string, unknown>; kind: string }) {
  const t = useMessages();
  // For a language check the useful comparison is source vs. result. For a layout
  // check, compare the restored text to what the post-processor handed the validator.
  const left = kind === "control-position" && typeof entry.restored === "string" ? "restored" : "original";
  const right = typeof entry.processed === "string" ? "processed" : "raw";
  const before = entry[left], after = entry[right];
  return <div className="grid min-w-0 gap-3 border-t border-border p-4">
    {typeof entry.reason === "string" && <div className="border-s-2 border-destructive/60 bg-destructive/5 px-3 py-2.5">
      <h4 className="text-xs font-semibold text-destructive">{t("windy.reason")}</h4>
      <p className="mt-1 whitespace-pre-wrap text-sm">{entry.reason}</p>
    </div>}
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      {typeof before === "string" && <TextPanel label={t(stageKeys[left])} value={before} />}
      {typeof after === "string" && <TextPanel label={t(stageKeys[right])} value={after} compare={left === "restored" && typeof before === "string" ? before : undefined} />}
    </div>
    <details className="admin-details"><summary>{t("windy.stages")}</summary>
      <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-2">
        {(Object.keys(stageKeys) as (keyof typeof stageKeys)[]).map(stage =>
          typeof entry[stage] === "string" && <TextPanel key={stage} label={t(stageKeys[stage])} value={entry[stage]} />)}
      </div>
    </details>
  </div>;
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "windy.title"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};

export default function WindyErrors() {
  const { groups, group, samples, selected, raw, page } = useLoaderData<typeof loader>();
  const t = useMessages();
  const locale = useUiLocale();
  const [params, setParams] = useSearchParams();
  const day=params.get("day");
  const backQuery=new URLSearchParams();
  if (day) backQuery.set("day", day);
  if (params.get("build")) backQuery.set("build",params.get("build")!);
  const evidence = useMemo(() => raw ? auditRecord(JSON.parse(raw).evidence) : null, [raw]);
  const attempts = Array.isArray(evidence?.attempts) ? evidence.attempts : [];
  const nameOf = (kind: string) => {
    const key = `windy.kind.${kind}`;
    return isMessageKey(key) ? t(key) : kind;
  };
  const sampleName = (sample: Sample) => formatDate(sample.received_at, { locale }) + " · " + sample.version + " · " + sample.id.slice(0, 8);
  const detail = typeof evidence?.message === "string" ? evidence.message : typeof evidence?.reason === "string" ? evidence.reason : null;
  const file = typeof evidence?.file === "string" ? evidence.file : null;
  return <main>
    <PageHeader compact title={t("windy.title")} actions={<Link className="text-primary" to={"/admin/windy-errors?"+backQuery}>{t("windy.day.back")}</Link>} />
    {day && group && <h2 className="text-lg font-bold">{day} · {nameOf(group.kind)}</h2>}
    {!group ? <EmptyState title={t("windy.empty")} /> :
      <div className={day ? "min-w-0" : "grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)]"}>
        {!day && <aside className="admin-panel lg:sticky lg:top-4">
          <h2 className="admin-section-title">{t("windy.types")}</h2>
          <nav aria-label={t("windy.types")} className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
            {groups.map(g => <Link key={g.kind} to={base + "?kind=" + g.kind} aria-current={group.kind === g.kind ? "page" : undefined}
              className="flex items-center justify-between gap-2 rounded-md border-s-2 border-transparent px-3 py-2.5 text-sm hover:bg-muted/10 aria-[current=page]:border-primary aria-[current=page]:bg-primary/10 aria-[current=page]:font-semibold aria-[current=page]:text-secondary">
              <span>{nameOf(g.kind)}</span><span className="shrink-0 tabular-nums text-xs">{t("windy.countShort", {count:g.occurrences})}</span>
            </Link>)}
          </nav>
        </aside>}
        <div className="grid min-w-0 gap-4">
          {!day && <section key={group.kind} className="admin-panel">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-xl font-bold">{nameOf(group.kind)}</h2>
              <Badge variant={group.fixed_build ? "positive" : "pending"}>{t(group.fixed_build ? "windy.resolved" : "windy.unresolved")}</Badge>
              <code className="text-xs text-muted">{group.kind}</code>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 xl:grid-cols-[auto_auto_1fr_1fr]">
              {[[t("windy.events"),group.occurrences],[t("windy.samples"),group.samples],[t("windy.seenFirst"),formatDate(group.first_seen,{locale})],[t("windy.seenLast"),formatDate(group.last_seen,{locale})]].map(([label,value]) =>
                <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className={typeof value === "number" ? "mt-1 text-2xl font-bold tabular-nums text-secondary" : "mt-1 text-sm font-medium"}>{value}</dd></div>)}
            </dl>
            <details className="admin-details mt-4"><summary>{t("windy.fixStatus")}</summary>
              <Form method="post" className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="kind" value={group.kind} />
                <div className="grid gap-1"><Label htmlFor="windy-fixed-build">{t("windy.fixed")}</Label>
                  <Input id="windy-fixed-build" name="build" type="number" min="1" required defaultValue={group.fixed_build ?? ""} /></div>
                <Button type="submit">{t("windy.resolve")}</Button>
              </Form>
            </details>
          </section>}
          {selected && raw && <section className="admin-panel grid gap-4" key={selected.id}>
            <header className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold">{t("windy.report")}</h2>
              <Button asChild variant="outline" size="sm"><a href={"data:application/json;charset=utf-8," + encodeURIComponent(raw)} download={selected.id + ".json"}><Download aria-hidden />{t("windy.download")}</a></Button>
            </header>
            <div className="grid min-w-0 gap-1.5">
              {!day && samples.length > 1 && samples.some(s=>s.id===selected.id) ? <><Label htmlFor="windy-sample">{t("windy.sample")}</Label><SelectField id="windy-sample" value={selected.id}
                options={samples.map(s=>({value:s.id,label:sampleName(s)}))}
                onValueChange={id=>{const next=new URLSearchParams(params); next.set("kind",group.kind); next.set("sample",id); setParams(next);}} /></>
                : <p className="text-sm">{sampleName(selected)}</p>}
              {file && <code className="text-xs text-muted">{file}</code>}
            </div>
            {!day && (page > 0 || (page+1)*30 < group.samples) && <nav className="admin-tabs">
              {page>0 && <Link to={base+"?kind="+group.kind+"&page="+(page-1)}>{t("windy.prev")}</Link>}
              {(page+1)*30<group.samples && <Link to={base+"?kind="+group.kind+"&page="+(page+1)}>{t("windy.next")}</Link>}
            </nav>}
            {detail && <TextPanel label={t("windy.error")} value={detail} />}
            {typeof evidence?.stack === "string" && <TextPanel label={t("windy.stack")} value={evidence.stack} />}
            {attempts.map((value,index) => {
              const attempt = auditRecord(value);
              if (!attempt) return null;
              return <details className="group/request min-w-0 overflow-hidden rounded-lg border border-border" key={index} open={index===attempts.length-1}>
                <summary className="flex cursor-pointer items-center gap-2 bg-muted/5 px-4 py-3 text-sm font-semibold group-open/request:bg-primary/10">
                  <ChevronRight aria-hidden className="size-4 text-secondary group-open/request:rotate-90" />
                  {t("windy.attempt",{n:typeof attempt.request === "number" ? attempt.request : index+1})}
                  {typeof attempt.model === "string" && <span className="ms-auto text-xs font-normal text-muted">{attempt.model}</span>}
                </summary>
                {Array.isArray(attempt.entries) && attempt.entries.map((row,i) => {
                  const entry = auditRecord(row);
                  return entry && <EntryEvidence key={i} entry={entry} kind={group.kind} />;
                })}
              </details>;
            }).reverse()}
            <details className="admin-details"><summary>{t("windy.raw")}</summary>
              <pre className="mt-3 max-h-[65vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/10 p-3 text-xs">{JSON.stringify(JSON.parse(raw),null,2)}</pre>
            </details>
          </section>}
        </div>
      </div>}
  </main>;
}
