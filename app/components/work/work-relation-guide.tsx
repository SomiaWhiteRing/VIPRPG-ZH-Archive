import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { InfoTooltip } from "@/app/components/ui/info-tooltip";
import { relationLabel } from "@/lib/labels";
import { translate, type MessageKey } from "@/lib/i18n/core";
import type { UiLocale } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { X } from "lucide-react";

const descriptions: Record<string, { text: MessageKey; example?: MessageKey }> = {
  adaptation: {
    text: "relation.guide.adaptation.text",
  },
  prequel: {
    text: "relation.guide.prequel.text",
    example: "relation.guide.prequel.example",
  },
  sequel: {
    text: "relation.guide.sequel.text",
    example: "relation.guide.sequel.example",
  },
  same_setting: {
    text: "relation.guide.same_setting.text",
  },
  alternative_setting: {
    text: "relation.guide.alternative_setting.text",
  },
  alternative_version: {
    text: "relation.guide.alternative_version.text",
  },
  character: {
    text: "relation.guide.character.text",
  },
  collaboration: {
    text: "relation.guide.collaboration.text",
    example: "relation.guide.collaboration.example",
  },
  version: {
    text: "relation.guide.version.text",
    example: "relation.guide.version.example",
  },
  main_version: {
    text: "relation.guide.main_version.text",
    example: "relation.guide.main_version.example",
  },
  collection: {
    text: "relation.guide.collection.text",
    example: "relation.guide.collection.example",
  },
  in_collection: {
    text: "relation.guide.in_collection.text",
    example: "relation.guide.in_collection.example",
  },
  original: {
    text: "relation.guide.original.text",
    example: "relation.guide.original.example",
  },
  translation: {
    text: "relation.guide.translation.text",
    example: "relation.guide.translation.example",
  },
};

const groups = [
  { title: "relation.guide.story", types: ["adaptation", "prequel", "sequel", "same_setting", "alternative_setting", "alternative_version"] },
  { title: "relation.guide.characters", types: ["character", "collaboration"] },
  { title: "relation.guide.versions", types: ["version", "main_version", "collection", "in_collection"] },
  { title: "relation.guide.translations", types: ["original", "translation"] },
] as const;

function label(type: string, locale: UiLocale) {
  return type === "original" || type === "translation"
    ? translate(locale, `relation.${type}`)
    : relationLabel(type, locale);
}

export function WorkRelationHint({ type }: { type: string }) {
  const t = useMessages();
  const locale = useUiLocale();
  const description = descriptions[type];
  return (
    <InfoTooltip>
      <div className="space-y-2">
        <p className="m-0 font-semibold">{t("relation.guide.direction", { type: label(type, locale) })}</p>
        <p className="m-0">{t(description.text)}</p>
        {description.example ? <p className="m-0 text-muted">{t(description.example)}</p> : null}
      </div>
    </InfoTooltip>
  );
}

export function WorkRelationGuide() {
  const t = useMessages();
  const locale = useUiLocale();
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button className="text-secondary" size="sm" type="button" variant="ghost">
          {t("relation.guide.title")}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="left-1/2 top-1/2 grid max-h-[85dvh] w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg">
          <header className="flex items-start gap-3 p-4 sm:p-5">
            <div className="min-w-0 flex-1">
              <Dialog.Title>{t("relation.guide.title")}</Dialog.Title>
              <Dialog.Description className="mb-0 mt-2 text-sm leading-6 text-muted">
                {t("relation.guide.intro")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button aria-label={t("relation.guide.close")} className="size-8" size="icon" type="button" variant="ghost">
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-5">
            <p className="m-0 rounded-md bg-muted/10 px-3 py-2 text-sm leading-6">
              {t("relation.guide.scope")}
            </p>
            {groups.map((group) => (
              <section key={group.title}>
                <h3 className="m-0 border-b border-border pb-2 text-sm font-bold text-muted">{t(group.title)}</h3>
                <dl className="m-0 divide-y divide-border">
                  {group.types.map((type) => (
                    <div className="grid gap-1 py-3 sm:grid-cols-[7em_minmax(0,1fr)] sm:gap-4" key={type}>
                      <dt className="text-sm font-semibold">{label(type, locale)}</dt>
                      <dd className="m-0 text-sm leading-6">
                        <p className="m-0">{t(descriptions[type].text)}</p>
                        {descriptions[type].example ? (
                          <p className="mb-0 mt-1 text-xs leading-5 text-muted">{t(descriptions[type].example!)}</p>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            <p className="m-0 border-t border-border pt-3 text-xs leading-5 text-muted">
              {t("relation.guide.reciprocal")}
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
