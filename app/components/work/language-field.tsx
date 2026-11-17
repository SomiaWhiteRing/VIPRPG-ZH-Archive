import { Label } from "@/app/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/app/components/ui/radio-group";
import { SelectField } from "@/app/components/ui/select";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { LANGUAGE_OPTIONS, languageLabel } from "@/lib/labels";
import { useState } from "react";

const primaryOptions = ["zh-CN", "ja", "other"] as const;

export function LanguageField({
  value,
  onValueChange,
  name,
  disabled = false,
}: {
  value: string;
  onValueChange: (value: string) => void;
  name?: string;
  disabled?: boolean;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const primary = value === "zh-CN" || value === "ja" ? value : "other";
  const otherOptions = LANGUAGE_OPTIONS.filter(
    (option) => option.value !== "zh-CN" && option.value !== "ja",
  );
  return (
    <>
      <RadioGroup
        aria-label={t("upload.language")}
        disabled={disabled}
        onValueChange={(next) =>
          onValueChange(
            next === "other"
              ? value === "zh-CN" || value === "ja"
                ? "en"
                : value
              : next,
          )
        }
        value={primary}
      >
        {primaryOptions.map((option) => (
          <Label className="flex items-center gap-2" key={option}>
            <RadioGroupItem value={option} />
            {option === "other" ? t("upload.metadata.other") : languageLabel(option, locale)}
          </Label>
        ))}
      </RadioGroup>
      {primary === "other" ? (
        <SelectField
          aria-label={t("upload.metadata.otherLanguage")}
          disabled={disabled}
          onValueChange={onValueChange}
          options={otherOptions.map((option) => ({
            value: option.value,
            label: languageLabel(option.value, locale),
          }))}
          value={value}
        />
      ) : null}
      {name ? <input name={name} type="hidden" value={value} /> : null}
    </>
  );
}

export function AdminLanguageField({
  value,
  name = "language",
}: {
  value: string;
  name?: string;
}) {
  const t = useMessages();
  const [language, setLanguage] = useState(value);

  return (
    <div className="grid gap-2 text-sm font-semibold">
      <span>{t("upload.metadata.language")}</span>
      <LanguageField name={name} onValueChange={setLanguage} value={language} />
    </div>
  );
}
