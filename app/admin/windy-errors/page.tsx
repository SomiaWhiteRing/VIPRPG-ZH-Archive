import { data, Form, useLoaderData, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { runtimeContext } from "@/app/.server/router-context";
import { requireBootstrapAdmin, requireBootstrapAdminPage } from "@/app/.server/auth/authorize";
import { getWindyEvidence } from "@/app/.server/windy-reports";
import { PageHeader } from "@/app/components/ui/page-header";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useMessages } from "@/lib/i18n/react";

const base = "/admin/windy-errors";
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
  const selected=samples.find(s=>s.id===query.get("sample")) ?? samples[0];
  const raw=selected ? await getWindyEvidence(rt,selected.id) : null;
  if (selected && !raw) throw new Response(null,{status:503});
  return data({groups,group,samples,selected,raw,page}, {headers:noStore});
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
export default function WindyErrors() {
  const {groups,group,samples,selected,raw,page}=useLoaderData<typeof loader>();
  const t=useMessages();
  const attempts: unknown = raw && JSON.parse(raw).evidence?.attempts;
  return <main><PageHeader compact title={t("windy.title")}/>
    <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <nav className="space-y-2">{groups.map(g=><Link key={g.kind} className="block text-primary" to={base+"?kind="+g.kind}>
        {g.kind} · {g.occurrences} / {g.samples}
      </Link>)}</nav>
      {group && <section className="min-w-0 space-y-4"><h2>{group.kind}</h2>
        <p>{t("windy.counts",{events:group.occurrences,samples:group.samples})} · {group.first_seen} — {group.last_seen} UTC</p>
        <Form method="post" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="kind" value={group.kind}/>
          <div><Label htmlFor="windy-fixed-build">{t("windy.fixed")}</Label><Input id="windy-fixed-build" name="build" type="number" min="1" required defaultValue={group.fixed_build ?? ""} key={group.kind}/></div>
          <Button type="submit">{t("windy.resolve")}</Button>
        </Form>
        <ul>{samples.map(s=><li key={s.id}><Link className="text-primary" to={base+"?kind="+group.kind+"&page="+page+"&sample="+s.id}>
          {s.received_at} UTC · {s.version} · {s.id}
        </Link></li>)}</ul>
        {page>0 && <Link to={base+"?kind="+group.kind+"&page="+(page-1)}>{t("windy.prev")}</Link>}
        {(page+1)*30<group.samples && <Link to={base+"?kind="+group.kind+"&page="+(page+1)}>{t("windy.next")}</Link>}
        {raw && selected && <><a className="text-primary" download={selected.id+".json"} href={"data:application/json;charset=utf-8,"+encodeURIComponent(raw)}>{t("windy.download")}</a>
          {Array.isArray(attempts) && attempts.map((attempt,index) => <details open={index===attempts.length-1} key={index}>
            <summary>{t("windy.attempt",{n:index+1})}</summary>
            {Array.isArray(attempt?.entries) && attempt.entries.map((entry: Record<string,unknown>, i: number) =>
              <dl key={i} className="grid gap-2 md:grid-cols-2">{["original","raw","restored","repaired","processed","reason"].map(stage =>
                typeof entry?.[stage]==="string" && <div key={stage}><dt className="font-mono">{stage}</dt>
                  <dd className="whitespace-pre-wrap break-all">{String(entry[stage])}</dd></div>)}</dl>)}
          </details>)}
          <details><summary>{t("windy.raw")}</summary><pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(JSON.parse(raw),null,2)}</pre></details></>}
      </section>}
    </div></main>;
}
