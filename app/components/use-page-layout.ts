import { useMatches, type UIMatch } from "react-router";
import { useClientEnvironment } from "./use-client-environment";

type PageLayout = {
  hideBackToTop?: boolean;
  hideSiteHeader?: boolean;
  hideSiteFooter?: boolean;
  accountLayout?: "full-width" | "standalone";
};

export type PageLayoutHandle = {
  layout?: PageLayout;
  androidLayout?: PageLayout;
};

export function usePageLayout() {
  const matches = useMatches() as UIMatch<unknown, PageLayoutHandle | undefined>[];
  const environment = useClientEnvironment();
  let layout: PageLayout = {};
  for (const { handle } of matches) {
    layout = { ...layout, ...handle?.layout, ...(environment === "android" ? handle?.androidLayout : undefined) };
  }
  return layout;
}
