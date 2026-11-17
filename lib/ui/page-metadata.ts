import { isRouteErrorResponse } from "react-router";
import type { MetaDescriptor } from "react-router";
import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE, parseUiLocale, UI_LOCALE_PARAM, type UiLocale } from "@/lib/i18n/locale";

const SITE_NAME = "VIPRPG.org";

export function pageMetadataLocale(
  search: string,
  matches: readonly { id: string; loaderData?: unknown }[],
): UiLocale {
  const selected = parseUiLocale(new URLSearchParams(search).get(UI_LOCALE_PARAM));
  if (selected) return selected;
  const root = matches.find((match) => match.id === "root")?.loaderData;
  const value = root && typeof root === "object" && "uiLocale" in root ? root.uiLocale : null;
  return parseUiLocale(typeof value === "string" ? value : null) ?? DEFAULT_UI_LOCALE;
}

export type PageMetadata = {
  title?: string | string[];
  page?: number;
  description?: string;
  alternates?: { canonical?: string };
};

export function pageMetaDescriptors(
  value: PageMetadata = {},
  error?: unknown,
  locale: UiLocale = DEFAULT_UI_LOCALE,
): MetaDescriptor[] {
  const description = translate(locale, "core.site.description");
  if (error != null) {
    value = {
      title:
        isRouteErrorResponse(error) && error.status === 404
          ? translate(locale, "core.notFound.title")
          : translate(locale, "core.pageError.title"),
    };
  }

  const parts = (Array.isArray(value.title) ? value.title : [value.title])
    .map((part) => part?.trim())
    .filter(Boolean);
  if (
    value.page !== undefined &&
    Number.isSafeInteger(value.page) &&
    value.page > 1
  ) {
    parts.push(translate(locale, "core.meta.page", { page: value.page }));
  }
  const title = parts.length
    ? [...parts, SITE_NAME].join(" | ")
    : [SITE_NAME, description].join(" | ");

  return [
    { title },
    {
      name: "description",
      content: value.description ?? description,
    },
    ...(value.alternates?.canonical
      ? [
          {
            tagName: "link",
            rel: "canonical",
            href: value.alternates.canonical,
          },
        ]
      : []),
  ];
}
