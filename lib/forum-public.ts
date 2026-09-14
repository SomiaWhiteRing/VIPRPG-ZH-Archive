import type { ForumContent, ForumTopic } from "./forum";

export type PublicForumTopic = Omit<ForumTopic,"capabilities">;
export type PublicForumContent = Omit<ForumContent,"capabilities"|"liked">;

export function publicTopicDto(topic:ForumTopic):PublicForumTopic {
  const {capabilities,...publicTopic}=topic;
  void capabilities;
  return publicTopic;
}
export function publicContentDto(content:ForumContent):PublicForumContent {
  const {capabilities,liked,...publicContent}=content;
  void capabilities;void liked;
  return publicContent;
}
