import type { ForumRequestRuntime } from "./request";

type Candidate = {id:number;count:number};
export async function forumTagHeat(ctx: ForumRequestRuntime) {
  const cache = typeof caches === "undefined" ? undefined : (caches as CacheStorage & {default?:Cache}).default;
  const key = new Request(`${ctx.origin}/__forum_tag_heat`);
  let saved: {at:string;items:Candidate[]} | null = null;
  const hit = await cache?.match(key);
  if(hit) saved = await hit.json();
  if(!saved) {
    const rows=await ctx.db.prepare(`SELECT x.tag_id AS id,COUNT(*) AS count FROM forum_topic_tags x
      JOIN forum_public_topics t ON t.id=x.topic_id WHERE t.created_at>=datetime('now','-90 days')
      GROUP BY x.tag_id ORDER BY count DESC,x.tag_id LIMIT 100`).all<Candidate>();
    saved={at:new Date().toISOString(),items:rows.results};
    if (cache) ctx.execution.waitUntil(cache.put(key,Response.json(saved,{headers:{"Cache-Control":"public,max-age=3600"}})));
  }
  const rows=await ctx.db.prepare(`SELECT id,name,status AS state,revision FROM forum_tags
    WHERE id IN(SELECT value FROM json_each(?)) AND status<>'hidden'`).bind(JSON.stringify(saved.items.map((r)=>r.id)))
    .all<{id:number;name:string;state:"active"|"disabled";revision:string}>();
  const live=new Map(rows.results.map((r)=>[r.id,r]));
  return {at:saved.at,tags:saved.items.filter((r)=>live.has(r.id)).slice(0,10).map((r)=>({...live.get(r.id)!,count:r.count}))};
}
