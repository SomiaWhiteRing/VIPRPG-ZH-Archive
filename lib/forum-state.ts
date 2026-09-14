import type { ForumCapabilities, ForumContent, ForumTopic, ForumViewer } from "@/lib/forum";
import type { PublicForumContent, PublicForumTopic } from "@/lib/forum-public";

export const emptyCapabilities:ForumCapabilities={edit:false,delete:false,reply:false,like:false,report:false,moderate:false,feature:false};
export function interactiveTopic(topic:PublicForumTopic,viewer:ForumViewer,capabilities?:ForumCapabilities|null):ForumTopic {
  return {...topic,capabilities:capabilities??{...emptyCapabilities,reply:!!viewer&&!topic.locked,report:!!viewer,moderate:!!viewer?.moderate,feature:!!viewer?.feature}};
}
export function interactiveContent(content:PublicForumContent,topic:ForumTopic,viewer:ForumViewer,liked:number[]=[]):ForumContent {
  const available=content.body!==null,own=available&&viewer?.id===content.author?.id;
  const root=content.kind==="post"&&content.postNumber===1;
  return {...content,liked:liked.includes(content.id),capabilities:{...emptyCapabilities,
    edit:root?topic.capabilities.edit:own&&!topic.locked,delete:root?topic.capabilities.delete:own,
    reply:available&&!!viewer&&!topic.locked,like:available&&!!viewer&&content.kind==="post",
    report:available&&!!viewer,moderate:!!viewer?.moderate&&content.state!=="deleted"}};
}
