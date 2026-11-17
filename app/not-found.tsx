import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { MetaFunction } from "react-router";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages } from "@/lib/i18n/react";
import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE, parseUiLocale, UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import type { loader as rootLoader } from "@/app/root";
export function loader() {
  throw new Response(null, { status: 404 });
}
export const meta: MetaFunction<typeof loader, { root: typeof rootLoader }> = ({ error, location, matches }) => {
  const root = matches.find(match => match.id === "root");
  const locale = root?.loaderData?.uiLocale ?? parseUiLocale(new URLSearchParams(location.search).get(UI_LOCALE_PARAM)) ?? DEFAULT_UI_LOCALE;
  return pageMetaDescriptors({ title: translate(locale, "core.notFound.title") }, error, locale);
};

export default function NotFound() {
  const t = useMessages();
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1>{t("core.notFound.title")}</h1>
      <Link to="/">{t("core.home.back")}</Link>
    </main>
  );
}
