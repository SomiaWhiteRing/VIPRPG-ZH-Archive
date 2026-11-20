import { RichMessage } from "@/app/components/ui/rich-message";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { CreatorPortrait } from "@/app/components/ui/creator-portrait";
import type { PublicCreatorListItem } from "@/lib/dto/db/creator-library";
import { LocaleLink as Link } from "@/app/components/ui/locale-link";

export function CreatorCard({ creator }: {
  creator: Omit<PublicCreatorListItem, "aliases"> & { aliases?: string[] };
}) {
  const t = useMessages();
  const locale = useUiLocale();
  return (
    <article className="h-full min-w-0">
      <Link
        className="group flex h-full min-w-0 items-start gap-3.5 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:gap-4 sm:p-5"
        to={`/creators/${creator.id}`}
      >
        <CreatorPortrait
          avatarBlobSha256={creator.avatarBlobSha256}
          className="size-16 shrink-0 text-2xl sm:size-18"
          name={creator.name}
          size={72}
        />
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <h2 className="m-0 text-base font-semibold leading-snug wrap-anywhere group-hover:text-primary sm:text-lg">
            {creator.name}
          </h2>
          {creator.aliases?.length ? (
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted wrap-anywhere sm:text-[13px]">
              <span className="sr-only">{t("creator.aliases")}</span>
              {locale === "en" ? new Intl.ListFormat(locale).format(creator.aliases) : creator.aliases.join("、")}
            </p>
          ) : null}
          {creator.bio ? (
            <p className="mt-2.5 line-clamp-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted wrap-anywhere">
              {creator.bio}
            </p>
          ) : null}
          <p className="mb-0 mt-3 text-xs text-muted">
            <RichMessage id="creator.participated" values={{ count: creator.workCreditCount }} components={{ emphasis: children => <span key="count" className="font-mono tabular-nums text-foreground">{children}</span> }} />
          </p>
        </div>
      </Link>
    </article>
  );
}
