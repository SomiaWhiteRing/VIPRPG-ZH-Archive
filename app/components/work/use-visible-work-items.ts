import { useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "@/app/root";
import type { WorkAudience } from "@/lib/work-visibility";

// List metadata and counts include members' works; only their presentation is hidden.
// Work details, downloads and interactions retain their own server authorization.
export function useVisibleWorkItems<T extends { audience: WorkAudience }>(items: T[]): T[] {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  return root?.session ? items : items.filter((item) => item.audience === "public");
}
