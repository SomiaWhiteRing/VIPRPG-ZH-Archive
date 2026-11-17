import { Button } from "@/app/components/ui/button";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { ENGINE_OPTIONS, engineLabel, engineShortLabel } from "@/lib/labels";
import { cn } from "@/lib/ui/cn";

type EngineOption = (typeof ENGINE_OPTIONS)[number];

export function EnginePicker({
  disabled = false,
  disabledReason,
  onValueChange,
  value,
}: {
  disabled?: boolean;
  disabledReason?: (option: EngineOption) => string | null;
  onValueChange: (value: EngineOption["value"]) => void;
  value: string;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  return (
    <div
      aria-label={t("upload.engine")}
      className="flex min-w-0 flex-wrap items-stretch gap-1.5"
      role="radiogroup"
    >
      {ENGINE_OPTIONS.map((option, index) => {
        const label = engineLabel(option.value, locale);
        const reason = disabledReason?.(option) ?? null;
        const optionDisabled = disabled || Boolean(reason);
        const selected = option.value === value;
        return (
          <span className="contents" key={option.value}>
            {index === 3 ? (
              <span
                aria-hidden="true"
                className="mx-1 min-h-8 w-px self-stretch bg-border max-sm:h-px max-sm:min-h-0 max-sm:w-full"
              />
            ) : null}
            <Button
              aria-checked={selected}
              aria-label={
                reason ? t("upload.metadata.engineUnavailable", { label, reason }) : label
              }
              className={cn(
                "min-h-8 rounded-full px-3 font-mono text-xs shadow-none",
                selected &&
                  "border-primary bg-primary text-primary-foreground hover:text-primary-foreground",
              )}
              disabled={optionDisabled}
              onClick={() => onValueChange(option.value)}
              role="radio"
              size="sm"
              title={reason ?? undefined}
              type="button"
              variant="outline"
            >
              {engineShortLabel(option.value, locale)}
            </Button>
          </span>
        );
      })}
    </div>
  );
}
