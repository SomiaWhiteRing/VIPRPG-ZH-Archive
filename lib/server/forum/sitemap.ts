import type { ForumRequestRuntime } from "./request";
import { HttpError } from "../http/json";

export async function forumSitemap(ctx:ForumRequestRuntime,shard?:number){
  const xmlEscape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const origin=xmlEscape(ctx.origin);
  let body:string;
  if(shard===undefined){
    const row=await ctx.db.prepare("SELECT MAX(id) AS maximum FROM forum_topics").first<{maximum:number|null}>();
    const count=Math.ceil((row?.maximum??0)/1000);
    if(count>50000)throw new HttpError(503,"站点地图索引已达到协议上限。");
    body=`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({length:count},(_,i)=>`<sitemap><loc>${origin}/discussions/sitemaps/${i}.xml</loc></sitemap>`).join('')}</sitemapindex>`;
  }else{
    if(!Number.isSafeInteger(shard)||shard<0||!Number.isSafeInteger((shard+1)*1000))throw new HttpError(404,"站点地图不存在。");
    const rows=await ctx.db.prepare("SELECT id,updated_at FROM forum_public_topics WHERE id>? AND id<=? ORDER BY id LIMIT 1000").bind(shard*1000,(shard+1)*1000).all<{id:number;updated_at:string}>();
    body=`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.results.map((r)=>`<url><loc>${origin}/discussions/${r.id}</loc><lastmod>${xmlEscape(r.updated_at.slice(0,10))}</lastmod></url>`).join('')}</urlset>`;
  }
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`,{headers:{"Content-Type":"application/xml; charset=utf-8","Cache-Control":"no-store"}});
}
