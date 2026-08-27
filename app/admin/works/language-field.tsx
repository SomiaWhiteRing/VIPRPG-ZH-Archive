"use client";

import { LANGUAGE_OPTIONS } from "@/lib/labels";
import { Label } from "@/app/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/app/components/ui/radio-group";
import { SelectField } from "@/app/components/ui/select";
import { useState } from "react";

const primaryOptions = [
  { value: "zh-CN", label: "简体中文" },
  { value: "ja", label: "日语" },
  { value: "other", label: "其他" },
] as const;

export function LanguageField({
  value,
  onValueChange,
  name,
}: {
  value: string;
  onValueChange: (value: string) => void;
  name?: string;
}) {
  const primary = value === "zh-CN" || value === "ja" ? value : "other";
  const otherOptions = LANGUAGE_OPTIONS.filter(
    (option) => option.value !== "zh-CN" && option.value !== "ja",
  );
  return (
    <>
      <RadioGroup
        aria-label="游戏语言"
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
          <Label className="flex items-center gap-2" key={option.value}>
            <RadioGroupItem value={option.value} />
            {option.label}
          </Label>
        ))}
      </RadioGroup>
      {primary === "other" ? (
        <SelectField
          onValueChange={onValueChange}
          options={otherOptions.map((option) => ({
            value: option.value,
            label: option.label,
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
  const [language, setLanguage] = useState(value);

  return (
    <div className="grid gap-2 text-sm font-semibold">
      <span>语言</span>
      <LanguageField name={name} onValueChange={setLanguage} value={language} />
    </div>
  );
}
