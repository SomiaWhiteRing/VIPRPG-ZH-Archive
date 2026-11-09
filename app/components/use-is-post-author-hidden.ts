import type { loader as rootLoader } from "@/app/root";
import { useRouteLoaderData } from "react-router";

export function useIsPostAuthorHidden() {
  const ids = useRouteLoaderData<typeof rootLoader>("root")?.session?.hiddenPostAuthorIds;
  return (id: number | null | undefined) => id != null && ids?.includes(id) === true;
}
