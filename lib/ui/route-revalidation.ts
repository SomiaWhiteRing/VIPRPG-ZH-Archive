import type { ShouldRevalidateFunction } from "react-router";
import { gyokuroStatsPath } from "@/lib/archive/netplay-ingress";

export function rootSearchParams(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  if (pathname === "/me/permissions") params.delete("role");
  if (pathname === gyokuroStatsPath) {
    params.delete("from");
    params.delete("to");
  }
  return params;
}

// The role parameter selects an already-loaded panel, without changing server data.
export const shouldRevalidatePermissionPanel: ShouldRevalidateFunction = ({
  currentUrl, nextUrl, formMethod, defaultShouldRevalidate,
}) => {
  if (!formMethod && currentUrl.pathname === "/me/permissions" && nextUrl.pathname === currentUrl.pathname
    && currentUrl.search !== nextUrl.search) {
    const current = rootSearchParams(currentUrl.pathname, currentUrl.search);
    const next = rootSearchParams(nextUrl.pathname, nextUrl.search);
    current.sort();
    next.sort();
    if (current.toString() === next.toString()) return false;
  }
  return defaultShouldRevalidate;
};

export const shouldRevalidateRoot: ShouldRevalidateFunction = args => {
  const { currentUrl, nextUrl, formMethod } = args;
  if (!formMethod && currentUrl.pathname === gyokuroStatsPath && nextUrl.pathname === gyokuroStatsPath
    && currentUrl.search !== nextUrl.search) {
    const current = rootSearchParams(currentUrl.pathname, currentUrl.search);
    const next = rootSearchParams(nextUrl.pathname, nextUrl.search);
    current.sort();
    next.sort();
    if (current.toString() === next.toString()) return false;
  }
  return shouldRevalidatePermissionPanel(args);
};
