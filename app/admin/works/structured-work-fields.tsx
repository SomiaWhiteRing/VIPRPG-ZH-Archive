import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { SelectField } from "@/app/components/ui/select";
import type { GameExternalLink } from "@/lib/dto/db/game-library";
import { useMessages } from "@/lib/i18n/react";
import { WORK_EXTERNAL_LINK_OPTIONS } from "@/lib/labels";

type ExternalLink = Pick<GameExternalLink, "label" | "url" | "linkType">;

export function ExternalLinkList({
  values,
  onChange,
}: {
  values: ExternalLink[];
  onChange: (values: ExternalLink[]) => void;
}) {
  const t = useMessages();
  const empty = { label: "", url: "", linkType: "other" };
  function update(index: number, value: Partial<ExternalLink>) {
    onChange(
      values.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...value } : item,
      ),
    );
  }
  return (
    <fieldset className="grid gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-semibold">{t("work.sidebar.external")}</legend>
      {values.map((link, index) => (
        <div
          className="grid gap-2 border-b border-border pb-3 last:border-0 last:pb-0 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)_160px_auto]"
          key={index}
        >
          <Input
            aria-label={t("upload.externalLinks.name", { index: index + 1 })}
            placeholder={t("upload.extras.name")}
            value={link.label}
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <Input
            aria-label={t("upload.externalLinks.url", { index: index + 1 })}
            placeholder="https://"
            type="url"
            value={link.url}
            onChange={(event) => update(index, { url: event.target.value })}
          />
          <SelectField
            aria-label={t("upload.externalLinks.type", { index: index + 1 })}
            value={link.linkType}
            onValueChange={(value) => update(index, { linkType: value })}
            options={WORK_EXTERNAL_LINK_OPTIONS.map(({ value }) => ({
              value,
              label: t(`entryHistory.link.${value}`),
            }))}
          />
          <Button
            onClick={() =>
              onChange(
                values.filter((_, itemIndex) => itemIndex !== index),
              )
            }
            type="button"
            variant="ghost"
          >
            {t("upload.externalLinks.delete")}
          </Button>
        </div>
      ))}
      <Button
        className="w-fit"
        onClick={() =>
          onChange([...values, empty])
        }
        size="sm"
        type="button"
        variant="outline"
      >
        {t("upload.externalLinks.add")}
      </Button>
    </fieldset>
  );
}

export function serializeExternalLinks(values: ExternalLink[]): string {
  return values.filter((item) => item.label || item.url)
    .map((item) => [item.label, item.url, item.linkType].map(escapePart).join("|"))
    .join("\n");
}

function escapePart(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}
