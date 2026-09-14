import { forumViewer, rawTopic, mapTopic, unavailable } from "./queries";
import type { ForumRuntime } from "./runtime";
import type { ArchiveUser } from "../db/user-access";
import { HttpError } from "../http/json";

export async function forumEngagement(ctx:ForumRuntime,user:ArchiveUser|null,topicId:number,postIds:number[]) {
  if(postIds.length>20||postIds.some((id)=>!Number.isSafeInteger(id)||id<1))throw new HttpError(400,"楼层集合无效。");
  const viewer=forumViewer(user);
  if(!viewer)return {viewer:null,liked:[],topicCapabilities:null};
  const topic=await rawTopic(ctx,topicId);
  if(!topic.public)unavailable();
  const own=topic.user_id===viewer.id;
  if(own) {
    const reply=await ctx.db.prepare(`SELECT id FROM forum_posts WHERE topic_id=? AND post_number<>1 AND status<>'deleted'
      UNION ALL SELECT c.id FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id WHERE p.topic_id=? AND c.status<>'deleted' LIMIT 1`)
      .bind(topicId,topicId).first();
    topic.deletable=reply?0:1;
  }
  const likes=await ctx.db.prepare(`SELECT l.post_id FROM forum_post_likes l JOIN forum_public_posts p ON p.id=l.post_id
    WHERE l.user_id=? AND p.topic_id=? AND l.post_id IN(SELECT value FROM json_each(?))`).bind(viewer.id,topicId,JSON.stringify(postIds)).all<{post_id:number}>();
  return {viewer,liked:likes.results.map((r)=>r.post_id),topicCapabilities:mapTopic(topic,viewer,[]).capabilities};
}
