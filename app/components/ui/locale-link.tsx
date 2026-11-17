import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useNavigationLocale } from "@/lib/i18n/react";
import { forwardRef } from "react";
import { Link, parsePath, useLocation, type LinkProps } from "react-router";

export const LocaleLink = forwardRef<HTMLAnchorElement, LinkProps>(function LocaleLink({ to, ...props }, ref) {
  const locale = useNavigationLocale();
  const { search } = useLocation();
  let path = typeof to === "string" ? parsePath(to) : to;
  if (!path.pathname && path.hash && path.search === undefined) {
    path = { ...path, search };
    to = path;
  }
  const internal = path.pathname
    ? path.pathname.startsWith("/") && !path.pathname.startsWith("//") &&
      !/^\/(?:api|assets|icon|play\/runtime)(?:\/|$)/.test(path.pathname)
    : path.search !== undefined || path.hash !== undefined;
  if (locale && internal) {
    const params = new URLSearchParams(path.search);
    if (!params.has(UI_LOCALE_PARAM)) {
      params.set(UI_LOCALE_PARAM, locale);
      to = { ...path, search: `?${params}` };
    }
  }
  return <Link {...props} ref={ref} to={to} />;
});
