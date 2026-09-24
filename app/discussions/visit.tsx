import { useContentView } from "@/app/components/use-content-view";

export function useDiscussionVisit(topicId?: number) {
  useContentView("topic", topicId);
}
