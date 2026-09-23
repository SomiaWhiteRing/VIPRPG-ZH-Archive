import { isRouteErrorResponse } from "react-router";
import type { MetaDescriptor } from "react-router";

const SITE_NAME = "VIPRPG.org";
const SITE_TAGLINE = "VIPRPG中文保管库";
const SITE_DESCRIPTION = "VIPRPG中文保管库";

export type PageMetadata = {
  title?: string | string[];
  page?: number;
  description?: string;
  alternates?: { canonical?: string };
};

export function pageMetaDescriptors(
  value: PageMetadata = {},
  error?: unknown,
): MetaDescriptor[] {
  if (error != null) {
    value = {
      title:
        isRouteErrorResponse(error) && error.status === 404
          ? "页面不存在"
          : "暂时无法打开页面",
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
    parts.push(`第 ${value.page} 页`);
  }
  const title = parts.length
    ? [...parts, SITE_NAME].join(" | ")
    : [SITE_NAME, SITE_TAGLINE].join(" | ");

  return [
    { title },
    {
      name: "description",
      content: value.description ?? SITE_DESCRIPTION,
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
