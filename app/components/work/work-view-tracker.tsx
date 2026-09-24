import { useContentView } from "@/app/components/use-content-view";

export function WorkViewTracker({ workId }: { workId: number }) {
  useContentView("work", workId);

  return null;
}
