import { LocaleLink } from "@/app/components/ui/locale-link";
import { useMessages } from "@/lib/i18n/react";
import type { WorkCreditSort } from "@/lib/params";

export function WorkCreditSortTabs({ basePath, sort }: { basePath: string; sort: WorkCreditSort }) {
  const t = useMessages();
  return (
    <nav aria-label={t("library.sortLabel")} className="flex gap-0.5 border-b border-border">
      {(["upload", "release"] as const).map(value => (
        <LocaleLink
          key={value}
          to={value === "upload" ? basePath : `${basePath}?sort=release`}
          aria-current={value === sort ? "page" : undefined}
          className="inline-flex min-h-10.5 items-center border-b-2 border-transparent px-3.25 text-sm text-muted hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:font-semibold aria-[current=page]:text-primary"
        >
          {value === "upload" ? t("library.uploadDate") : t("library.release")}
        </LocaleLink>
      ))}
    </nav>
  );
}
