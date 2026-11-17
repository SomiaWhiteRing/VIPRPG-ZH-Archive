import { formatNumber } from "@/lib/format";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { tagHref, type CombinedTagSummary } from "@/lib/user-tags";

export function TagCloud({
  tags,
  label,
}: {
  tags: CombinedTagSummary[];
  label?: string;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  return (
    <section aria-label={label ?? t("admin.tags.list")}>
      <ul className="m-0 flex list-none flex-wrap items-baseline gap-x-4 gap-y-2 p-0 text-base leading-relaxed">
        {tags.map((tag) => (
          <li className="min-w-0 max-w-full" key={tag.name}>
            <Link
              className="wrap-anywhere text-primary hover:underline"
              to={tagHref(tag.name)}
            >
              {tag.name}
            </Link>
            <small className="ml-1 whitespace-nowrap text-xs text-muted">
              ({formatNumber(tag.usageCount, locale)})
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
