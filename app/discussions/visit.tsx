import { useEffect } from "react";
import { useLocation } from "react-router";
import { forumRequest } from "./shared";

let viewedTopic: number | null = null;

// The root layout survives pagination. Leaving a topic starts a new visit;
// reloading the document also starts fresh because this state is in memory.
export function DiscussionVisitBoundary() {
  const pathname = useLocation().pathname;
  useEffect(() => {
    if (viewedTopic !== null && pathname !== `/discussions/${viewedTopic}`)
      viewedTopic = null;
  }, [pathname]);
  return null;
}

export function useDiscussionVisit(topicId?: number) {
  useEffect(() => {
    if (!topicId) return;
    function record() {
      if (document.visibilityState !== "visible" || viewedTopic === topicId)
        return;
      viewedTopic = topicId!;
      void forumRequest("/api/discussions", { op: "view", topicId }).catch(
        () => {
          if (viewedTopic === topicId) viewedTopic = null;
        },
      );
    }
    record();
    document.addEventListener("visibilitychange", record);
    return () => document.removeEventListener("visibilitychange", record);
  }, [topicId]);
}
