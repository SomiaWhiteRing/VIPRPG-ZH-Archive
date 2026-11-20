import { data, redirect, useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { runtimeContext } from "@/app/.server/router-context";
import { requireBootstrapAdminPage } from "@/app/.server/auth/authorize";
import { dayFilter, dayRows, indexLegacyReports, type DaySample } from "@/app/.server/windy-days";
import { PageHeader } from "@/app/components/ui/page-header";
import { Badge } from "@/app/components/ui/badge";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { PaginationLinks } from "@/app/components/library/pagination-links";
import { useMessages, useNavigationLocale, useUiLocale } from "@/lib/i18n/react";
import { isMessageKey, translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { formatDate, formatDateKey } from "@/lib/format";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { Download } from "lucide-react";

const base="/admin/windy-errors";
export const headers=()=>({"Cache-Control":"private, no-store"});
export async function loader({request,context}:LoaderFunctionArgs) {
  const rt=context.get(runtimeContext);
  await requireBootstrapAdminPage(rt,base);
  const url=new URL(request.url);
  if (url.searchParams.has("kind")) return redirect(base+"/detail"+url.search);
  const {day,build}=dayFilter(url);
  while (await indexLegacyReports(rt)===30) { /* Finish indexing older evidence. */ }
  const today=formatDateKey(new Date());
  const date=new Date(day+"T00:00:00Z");
  const monday=date.getTime()-((date.getUTCDay()+6)%7)*86_400_000;
  const weekDate=(offset:number)=>new Date(monday+offset*86_400_000).toISOString().slice(0,10);
  const weekTotals=await rt.db.prepare("SELECT report_day AS day,sum(occurrences) AS n FROM windy_error_reports WHERE report_day BETWEEN ? AND ? AND (?='' OR coalesce(nullif(build_id,''),version)=?) GROUP BY report_day")
    .bind(weekDate(0),weekDate(6),build,build).all<{day:string;n:number}>();
  const counts=new Map(weekTotals.results.map(row=>[row.day,row.n]));
  const releases=await rt.db.prepare(`SELECT DISTINCT a.application_build_id AS id,r.version_label AS version,date(r.published_at,'+8 hours') AS day
    FROM tool_artifacts a JOIN tool_releases r ON r.id=a.release_id JOIN resources s ON s.id=r.resource_id
    WHERE s.slug='windy-translator' AND a.target='windows-x64' AND a.application_build_id IS NOT NULL
      AND r.published_at IS NOT NULL ORDER BY r.published_at DESC`).all<{id:string;version:string;day:string}>();
  const week=Array.from({length:7},(_,i)=>weekDate(i)).filter(d=>d<=today || d===day).map(day=>({
    day,n:counts.get(day) ?? 0,releases:releases.results.filter(r=>r.day===day && (!build || r.id===build))
  }));
  const observed=await rt.db.prepare("SELECT coalesce(nullif(build_id,''),version) AS id, max(version) AS version FROM windy_error_reports GROUP BY coalesce(nullif(build_id,''),version) ORDER BY max(report_day) DESC")
    .all<{id:string;version:string}>();
  const builds=new Map(observed.results.map(r=>[r.id,r.version]));
  for (const release of releases.results) builds.set(release.id,release.version);
  const totals=await rt.db.prepare("SELECT count(*) AS samples,coalesce(sum(occurrences),0) AS events FROM windy_error_reports WHERE report_day=? AND (?='' OR coalesce(nullif(build_id,''),version)=?)").bind(day,build,build).first<{samples:number;events:number}>();
  const count=totals?.samples ?? 0;
  const page=Math.max(1,Math.min(Math.ceil(count/30),Math.trunc(Number(url.searchParams.get("page"))) || 1));
  const rows=await rt.db.prepare(dayRows+" ORDER BY coalesce(r.occurred_at,replace(r.received_at,' ','T')) DESC,r.id DESC LIMIT 30 OFFSET ?").bind(day,build,build,(page-1)*30).all<DaySample>();
  return data({day,build,today,week,previousWeek:weekDate(-7),nextWeek:weekDate(7),builds:Array.from(builds,([id,version])=>({id,version})),
    count,events:totals?.events ?? 0,page,rows:rows.results,locale:rt.uiLocale},{headers:headers()});
}
export const meta:MetaFunction<typeof loader>=({loaderData,error,location,matches})=>{
  const locale=loaderData?.locale ?? pageMetadataLocale(location.search,matches);
  return pageMetaDescriptors({title:[translate(locale,"windy.title"),translate(locale,"admin.characterIndex.console")]},error,locale);
};

export default function WindyDays() {
  const {day,build,today,week,previousWeek,nextWeek,builds,rows,count,events,page}=useLoaderData<typeof loader>();
  const t=useMessages(), locale=useUiLocale(), navLocale=useNavigationLocale();
  const query=new URLSearchParams({day});
  if(build) query.set("build",build);
  const forDay=(date:string)=>base+"?"+new URLSearchParams({...Object.fromEntries(query),day:date});
  return <main>
    <PageHeader compact title={t("windy.title")} />
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="admin-panel"><h2 className="admin-section-title">{t("windy.day.recent")}</h2>
        <nav aria-label={t("windy.day.recent")} className="admin-tabs grid">
          {week.map(r=><Link key={r.day} to={forDay(r.day)} aria-current={day===r.day?"page":undefined}>
            {r.day}{r.day===today ? " · "+t("windy.day.today") : ""} <span className="float-end tabular-nums">{r.n}</span>
            {r.releases.map(release=><span className="admin-cell-meta" key={release.id}>{t("windy.day.release",{version:release.version})}</span>)}</Link>)}
        </nav>
        <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-3 text-sm text-primary">
          <Link to={forDay(previousWeek)}>{t("windy.day.prevWeek")}</Link>
          {nextWeek<=today && <Link to={forDay(nextWeek)}>{t("windy.day.nextWeek")}</Link>}
          {day!==today && <Link to={forDay(today)}>{t("windy.day.today")}</Link>}
        </div>
      </aside>
      <section className="admin-panel grid min-w-0 gap-4">
        <form action={base} method="get" key={day+":"+build} className="flex flex-wrap items-end gap-3">
          {navLocale && <input type="hidden" name={UI_LOCALE_PARAM} value={navLocale}/>}
          <div className="grid gap-1"><Label htmlFor="windy-day">{t("windy.day.date")}</Label>
            <Input type="date" name="day" id="windy-day" defaultValue={day} required/></div>
          <div className="grid min-w-0 max-w-full gap-1"><Label htmlFor="windy-build">{t("windy.day.build")}</Label>
            <SelectField id="windy-build" name="build" defaultValue={build} options={[{value:"",label:t("windy.day.all")},...builds.map(b=>({value:b.id,label:b.id===b.version?b.version:b.version+" · "+b.id}))]}/></div>
          <Button type="submit">{t("admin.list.apply")}</Button>
        </form>
        <header className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div><h2 className="text-xl font-bold tabular-nums">{day}</h2>
          <p className="mt-1 text-sm text-muted">{t("windy.counts",{events,samples:count})}</p></div>
          {count>0 && <a className={buttonVariants({variant:"outline",size:"sm"})} href={base+"/export?"+query} download>
            <Download aria-hidden/>{t("windy.day.export")}</a>}
        </header>
        {count===0 ? <EmptyState variant="plain" title={t("windy.day.empty")}/> :
          <TableWrap compact minWidth={600} label={t("windy.report")}>
            <thead><tr><th>{t("windy.day.time")}</th><th>{t("windy.day.issue")}</th><th>{t("windy.day.build")}</th><th>{t("windy.events")}</th></tr></thead>
            <tbody>{rows.map(r=>{
              const key="windy.kind."+r.kind;
              const firstHere=r.first_day===day && r.first_build===(r.build_id || r.version);
              const detail=new URLSearchParams({kind:r.kind,sample:r.id,day});
              if(build) detail.set("build",build);
              return <tr key={r.id}><td className="text-sm tabular-nums">{formatDate(r.occurred_at ?? r.received_at,{locale})}
                {!r.occurred_at && <span className="admin-cell-meta">{t("windy.day.receipt")}</span>}</td>
                <td><Link className="admin-cell-title" to={base+"/detail?"+detail}>{r.issue_summary || (isMessageKey(key)?t(key):r.kind)}</Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge variant={firstHere?"pending":"neutral"}>{t(firstHere?"windy.day.first":"windy.day.repeat")}</Badge>
                    {isMessageKey(key)?t(key):r.kind}</div></td>
                <td>{r.version}<code className="admin-cell-meta">{r.build_id}</code></td><td className="tabular-nums">{r.occurrences}</td></tr>;
            })}</tbody>
          </TableWrap>}
        <PaginationLinks page={page} pageSize={30} total={count} basePath={base} params={{day,build}} compact/>
      </section>
    </div></main>;
}
