import type { ShouldRevalidateFunction } from "react-router";

// The role parameter selects an already-loaded panel, without changing server data.
export const shouldRevalidatePermissionPanel: ShouldRevalidateFunction = ({
  currentUrl, nextUrl, formMethod, defaultShouldRevalidate,
}) => {
  if (!formMethod && currentUrl.pathname === "/me/permissions" && nextUrl.pathname === currentUrl.pathname
    && currentUrl.search !== nextUrl.search) {
    const current = new URLSearchParams(currentUrl.search);
    const next = new URLSearchParams(nextUrl.search);
    current.delete("role");
    next.delete("role");
    current.sort();
    next.sort();
    if (current.toString() === next.toString()) return false;
  }
  return defaultShouldRevalidate;
};
