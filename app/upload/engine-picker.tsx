"use client";

import { Button } from "@/app/components/ui/button";
import { ENGINE_OPTIONS } from "@/lib/labels";
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
  return (
    <div
      aria-label="选择游戏引擎"
      className="flex min-w-0 flex-wrap items-stretch gap-1.5"
      role="radiogroup"
    >
      {ENGINE_OPTIONS.map((option, index) => {
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
              aria-label={reason ? `${option.label}（${reason}）` : option.label}
              className={cn(
                "min-h-8 rounded-full px-3 font-mono text-xs shadow-none",
                selected && "border-primary bg-primary text-primary-foreground hover:text-primary-foreground",
              )}
              disabled={optionDisabled}
              onClick={() => onValueChange(option.value)}
              role="radio"
              size="sm"
              title={reason ?? undefined}
              type="button"
              variant="outline"
            >
              {option.shortLabel}
            </Button>
          </span>
        );
      })}
    </div>
  );
}
