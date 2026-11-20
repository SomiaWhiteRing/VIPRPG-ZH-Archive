import { Zip, ZipPassThrough, strToU8 } from "fflate";
import type { LoaderFunctionArgs } from "react-router";
import { runtimeContext } from "@/app/.server/router-context";
import { requireBootstrapAdminPage } from "@/app/.server/auth/authorize";
import { dayFilter, dayRows, indexLegacyReports, windyObjectKey, type DaySample } from "@/app/.server/windy-days";

export async function loader({request,context}: LoaderFunctionArgs) {
  const rt=context.get(runtimeContext);
  await requireBootstrapAdminPage(rt,"/admin/windy-errors");
  const {day,build}=dayFilter(new URL(request.url));
  while (await indexLegacyReports(rt)===30) { /* Continue the one-time index before reading. */ }
  const maxRow=await rt.db.prepare("SELECT coalesce(max(rowid),0) AS high FROM windy_error_reports").first<number>("high");
  async function* files() {
    let cursor=0;
    const index: DaySample[]=[];
    while (true) {
      const rows=await rt.db.prepare(dayRows.replace("SELECT r.id","SELECT r.rowid AS seq,r.id")+
        " AND r.rowid>? AND r.rowid<=? ORDER BY r.rowid LIMIT 50").bind(day,build,build,cursor,maxRow).all<DaySample & {seq:number}>();
      for (const {seq,...row} of rows.results) {
        const object=await rt.bucket.get(windyObjectKey(row.id));
        if (!object) throw new Error("Missing Windy evidence");
        yield {name:"reports/"+row.id+".json",bytes:new Uint8Array(await object.arrayBuffer())};
        index.push(row);
        cursor=seq;
      }
      if (rows.results.length<50) break;
    }
    yield {name:"manifest.json",bytes:strToU8(JSON.stringify({day,timeZone:"UTC+08:00",build:build||null,
      occurrences:index.reduce((total,row)=>total+row.occurrences,0),reports:index},null,2))};
  }
  const items=files();
  let archive:Zip;
  const stream=new ReadableStream<Uint8Array>({
    start(controller) {
      archive=new Zip((error,chunk,final)=>{
        if (error) {controller.error(error); return;}
        controller.enqueue(chunk);
        if (final) controller.close();
      });
    },
    async pull() {
      const file=await items.next();
      if (file.done) {archive.end();return;}
      const entry=new ZipPassThrough(file.value.name);
      archive.add(entry);
      entry.push(file.value.bytes,true);
    },
    async cancel() {await items.return(undefined); archive.terminate();}
  });
  return new Response(stream,{headers:{"Content-Type":"application/zip","Cache-Control":"private, no-store",
    "Content-Disposition":`attachment; filename="windy-errors-${day}.zip"`,"X-Content-Type-Options":"nosniff"}});
}
