import { useMessages, useUiLocale } from "@/lib/i18n/react";
import type { MessageKey } from "@/lib/i18n/core";
import type { UiLocale } from "@/lib/i18n/locale";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import type { OriginalReleasePrecision } from "@/lib/original-release-date";
import { parseOriginalReleaseDate } from "@/lib/original-release-date";
import { parsePastedReleaseDates } from "@/lib/pasted-release-date";
import { enUS } from "date-fns/locale/en-US";
import { ja } from "date-fns/locale/ja";
import { zhCN } from "date-fns/locale/zh-CN";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import DatePicker from "react-datepicker";
import "./precision-date-picker.css";

const calendarClassName = [
  "w-64 border-border rounded-md bg-card text-foreground font-sans text-sm shadow-surface",
  String.raw`[&_:is(.react-datepicker\_\_month-container,.react-datepicker\_\_year--container)]:w-full`,
  String.raw`[&_:is(.react-datepicker\_\_year-wrapper)]:grid [&_:is(.react-datepicker\_\_year-wrapper)]:grid-cols-3 [&_:is(.react-datepicker\_\_year-wrapper)]:grid-rows-4 [&_:is(.react-datepicker\_\_year-wrapper)]:h-full [&_:is(.react-datepicker\_\_year-wrapper)]:max-w-none`,
  String.raw`[&_:is([role=table],.react-datepicker\_\_year,.react-datepicker\_\_monthPicker)]:box-border [&_:is([role=table],.react-datepicker\_\_year,.react-datepicker\_\_monthPicker)]:h-64 [&_:is([role=table],.react-datepicker\_\_year,.react-datepicker\_\_monthPicker)]:m-0 [&_:is([role=table],.react-datepicker\_\_year,.react-datepicker\_\_monthPicker)]:p-2`,
  String.raw`[&_:is(.react-datepicker\_\_month)]:m-0`,
  String.raw`[&_:is(.react-datepicker\_\_monthPicker)]:grid [&_:is(.react-datepicker\_\_monthPicker)]:grid-rows-4`,
  String.raw`[&_:is(.react-datepicker\_\_month-wrapper)]:grid [&_:is(.react-datepicker\_\_month-wrapper)]:grid-cols-3`,
  String.raw`[&_:is(.react-datepicker\_\_year-text,.react-datepicker\_\_month-text)]:flex [&_:is(.react-datepicker\_\_year-text,.react-datepicker\_\_month-text)]:items-center [&_:is(.react-datepicker\_\_year-text,.react-datepicker\_\_month-text)]:justify-center [&_:is(.react-datepicker\_\_year-text,.react-datepicker\_\_month-text)]:min-w-0 [&_:is(.react-datepicker\_\_year-text,.react-datepicker\_\_month-text)]:w-auto`,
  String.raw`[&_:is(.react-datepicker\_\_day-names,.react-datepicker\_\_week)]:h-[2.125rem]`,
  String.raw`[&_:is(.react-datepicker\_\_day-names)]:m-0`,
  String.raw`[&_:is(.react-datepicker\_\_day-name,.react-datepicker\_\_day)]:w-8 [&_:is(.react-datepicker\_\_day-name,.react-datepicker\_\_day)]:m-[0.0625rem] [&_:is(.react-datepicker\_\_day-name,.react-datepicker\_\_day)]:leading-8`,
  String.raw`[&_:is(.react-datepicker\_\_header)]:border-border [&_:is(.react-datepicker\_\_header)]:bg-background`,
  String.raw`[&_:is(.react-datepicker\_\_current-month,.react-datepicker\_\_day-name,.react-datepicker\_\_day,.react-datepicker\_\_month-text,.react-datepicker\_\_year-text)]:text-foreground`,
  String.raw`[&_:is(.react-datepicker\_\_day--keyboard-selected,.react-datepicker\_\_month-text--keyboard-selected,.react-datepicker\_\_year-text--keyboard-selected)]:bg-primary/15`,
  String.raw`[&_:is(.react-datepicker\_\_day--selected,.react-datepicker\_\_month-text--selected,.react-datepicker\_\_year-text--selected)]:bg-primary [&_:is(.react-datepicker\_\_day--selected,.react-datepicker\_\_month-text--selected,.react-datepicker\_\_year-text--selected)]:text-primary-foreground`,
  String.raw`[&_:is(.react-datepicker\_\_day--disabled,.react-datepicker\_\_month-text--disabled,.react-datepicker\_\_year-text--disabled)]:text-muted! [&_:is(.react-datepicker\_\_day--disabled,.react-datepicker\_\_month-text--disabled,.react-datepicker\_\_year-text--disabled)]:opacity-50`,
  String.raw`[&_:is(.react-datepicker\_\_day--outside-month)]:text-muted!`,
  String.raw`dark:[&_:is(.react-datepicker\_\_day,.react-datepicker\_\_month-text,.react-datepicker\_\_year-text):hover]:bg-muted/15`,
  String.raw`dark:[&_:is(.react-datepicker\_\_day--selected,.react-datepicker\_\_month-text--selected,.react-datepicker\_\_year-text--selected):hover]:bg-primary/90`,
  String.raw`dark:[&_:is(.react-datepicker\_\_day--disabled,.react-datepicker\_\_month-text--disabled,.react-datepicker\_\_year-text--disabled):hover]:bg-transparent`,
].join(" ");

type DatePrecision = Exclude<OriginalReleasePrecision, "unknown">;
const DATE_FORMATS: Record<DatePrecision, string> = {
  year: "yyyy年",
  month: "yyyy年M月",
  day: "yyyy年M月d日",
};
const ISO_DATE_FORMATS: Record<DatePrecision, string> = {
  year: "yyyy",
  month: "yyyy-MM",
  day: "yyyy-MM-dd",
};
const DATE_PARTS = ["year", "month", "day"] as const;
const DATE_UNITS = ["年", "月", "日"];
const MIN_DATE = new Date("0001-01-01T00:00:00");
const MAX_DATE = new Date("9999-12-31T00:00:00");

export function PrecisionDatePicker({
  id,
  value,
  onChange,
  placeholder,
  disabled = false,
  required = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const parsed = parseOriginalReleaseDate(value);
  const pickerRef = useRef<DatePicker>(null);
  const [precision, setPrecision] = useState<DatePrecision>("year");
  const [pasteError, setPasteError] = useState<MessageKey | null>(null);
  const [pasteCandidates, setPasteCandidates] = useState<string[]>([]);
  const pasteGenerationRef = useRef(0);
  const currentValueRef = useRef(value);
  useLayoutEffect(() => {
    currentValueRef.current = value;
  }, [value]);
  const selected = parsed?.value ? toLocalDate(parsed.value) : null;
  const displayValue = parsed?.value ? displayDateValue(parsed.value, locale) : "";

  function applyPastedDate(next: string) {
    const pasted = parseOriginalReleaseDate(next);
    if (!pasted?.value || pasted.precision === "unknown") return;
    pasteGenerationRef.current += 1;
    setPasteError(null);
    setPasteCandidates([]);
    setPrecision(pasted.precision);
    onChange(pasted.value);
    pickerRef.current?.setOpen(false);
  }

  return (
    <div className="relative min-w-0">
      <DatePicker
        ariaDescribedBy={pasteError ? `${id}-paste-error` : undefined}
        autoComplete="off"
        calendarClassName={calendarClassName}
        chooseDayAriaLabelPrefix={t("core.ui.date.choose")}
        customInput={
          <DateSegmentInput
            className="cursor-pointer pr-10 caret-transparent selection:bg-primary selection:text-primary-foreground"
            onPaste={async (event) => {
              event.preventDefault();
              if (disabled) return;
              const input = event.currentTarget;
              const previousValue = currentValueRef.current;
              const text = event.clipboardData.getData("text/plain");
              const generation = ++pasteGenerationRef.current;
              setPasteError(null);
              setPasteCandidates([]);
              try {
                const candidates = await parsePastedReleaseDates(text);
                if (
                  generation !== pasteGenerationRef.current ||
                  input.disabled ||
                  !input.isConnected ||
                  currentValueRef.current !== previousValue
                ) return;
                if (candidates.length === 1) {
                  applyPastedDate(candidates[0]);
                } else if (candidates.length > 1) {
                  pickerRef.current?.setOpen(false);
                  setPasteCandidates(candidates);
                } else {
                  setPasteError("core.ui.date.invalid");
                }
              } catch {
                if (generation === pasteGenerationRef.current && input.isConnected &&
                  !input.disabled && currentValueRef.current === previousValue) {
                  setPasteError("core.ui.date.pasteFailed");
                }
              }
            }}
            onPrecisionChange={(next) => {
              setPrecision(next);
              pickerRef.current?.setOpen(true);
            }}
            precision={precision}
          />
        }
        dateFormat={(locale === "en" ? ISO_DATE_FORMATS : DATE_FORMATS)[precision]}
        disabled={disabled}
        disabledDayAriaLabelPrefix={t("core.ui.date.disabled")}
        id={id}
        locale={locale === "ja" ? ja : locale === "en" ? enUS : zhCN}
        maxDate={MAX_DATE}
        minDate={MIN_DATE}
        onChangeRaw={(event, selection) => {
          if (!selection) event?.preventDefault();
        }}
        onSelect={(date) => {
          pasteGenerationRef.current += 1;
          setPasteError(null);
          setPasteCandidates([]);
          onChange(
            date ? updateDatePart(date, precision, parsed?.value ?? "") : "",
          );
          if (date && precision !== "day") {
            setPrecision(precision === "year" ? "month" : "day");
            pickerRef.current?.setFocus();
          }
        }}
        openToDate={selected ?? undefined}
        placeholderText={placeholder ?? t("core.ui.date.placeholder")}
        popperClassName="z-50"
        popperPlacement="bottom-start"
        portalId={`${id}-calendar`}
        ref={pickerRef}
        renderCustomHeader={(header) => (
          <div className="px-2 pb-1">
            <div className="flex items-center justify-between">
              <Button
                aria-label={
                  precision === "day"
                    ? t("core.ui.date.previousMonth")
                    : precision === "month"
                      ? t("core.ui.date.previousYear")
                      : t("core.ui.date.previousRange")
                }
                className="size-8"
                disabled={
                  precision === "day"
                    ? header.prevMonthButtonDisabled
                    : header.prevYearButtonDisabled
                }
                onClick={
                  precision === "day"
                    ? header.decreaseMonth
                    : header.decreaseYear
                }
                size="icon"
                type="button"
                variant="ghost"
              >
                <ChevronLeft aria-hidden />
              </Button>
              <span aria-live="polite" className="text-sm font-medium">
                {precision === "year" && header.visibleYearsRange
                  ? `${header.visibleYearsRange.startYear} – ${header.visibleYearsRange.endYear}`
                  : new Intl.DateTimeFormat(locale, { year: "numeric", month: precision === "day" ? "long" : undefined }).format(header.date)}
              </span>
              <Button
                aria-label={
                  precision === "day"
                    ? t("core.ui.date.nextMonth")
                    : precision === "month"
                      ? t("core.ui.date.nextYear")
                      : t("core.ui.date.nextRange")
                }
                className="size-8"
                disabled={
                  precision === "day"
                    ? header.nextMonthButtonDisabled
                    : header.nextYearButtonDisabled
                }
                onClick={
                  precision === "day"
                    ? header.increaseMonth
                    : header.increaseYear
                }
                size="icon"
                type="button"
                variant="ghost"
              >
                <ChevronRight aria-hidden />
              </Button>
            </div>
          </div>
        )}
        required={required}
        selected={selected}
        shouldCloseOnSelect={precision === "day"}
        showMonthYearPicker={precision === "month"}
        showPopperArrow={false}
        showYearPicker={precision === "year"}
        strictParsing
        value={displayValue}
        wrapperClassName="w-full"
      />
      {!required && value ? (
        <Button
          aria-label={t("core.ui.date.clear")}
          className="absolute right-1 top-1 size-8 text-muted"
          disabled={disabled}
          onClick={() => {
            pasteGenerationRef.current += 1;
            setPasteError(null);
            setPasteCandidates([]);
            setPrecision("year");
            onChange("");
            pickerRef.current?.setOpen(false);
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X aria-hidden className="size-4" />
        </Button>
      ) : (
        <CalendarDays
          aria-hidden
          className="pointer-events-none absolute right-3 top-3 size-4 text-muted"
        />
      )}
      {pasteError ? (
        <p
          className="mt-1 text-sm text-red-700 dark:text-red-300"
          id={`${id}-paste-error`}
          role="alert"
        >
          {t(pasteError)}
        </p>
      ) : null}
      {pasteCandidates.length ? (
        <div aria-label={t("core.ui.date.candidates")} className="mt-2 grid gap-2" role="group">
          <p className="text-sm text-muted" role="status">
            {t("core.ui.date.ambiguous")}
          </p>
          <div className="flex flex-wrap gap-2">
            {pasteCandidates.map((candidate) => (
              <Button
                disabled={disabled}
                key={candidate}
                onClick={() => applyPastedDate(candidate)}
                size="sm"
                type="button"
                variant="outline"
              >
                {displayDateValue(candidate, locale)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type DateSegmentInputProps = InputHTMLAttributes<HTMLInputElement> & {
  precision: DatePrecision;
  onPrecisionChange: (precision: DatePrecision) => void;
};

const DateSegmentInput = forwardRef<HTMLInputElement, DateSegmentInputProps>(
  function DateSegmentInput(
    {
      precision,
      onPrecisionChange,
      onClick,
      onKeyDown,
      onFocus,
      onBlur,
      value,
      ...props
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    const pointerFocus = useRef(false);

    useLayoutEffect(() => {
      const input = inputRef.current;
      if (input && document.activeElement === input)
        selectDatePart(input, precision);
    }, [precision, value]);

    return (
      <Input
        {...props}
        inputMode="none"
        onBeforeInput={(event) => event.preventDefault()}
        onBlur={(event) => {
          pointerFocus.current = false;
          onBlur?.(event);
        }}
        onClick={(event) => {
          const input = event.currentTarget;
          const next = clickedDatePart(
            input,
            event.detail ? event.clientX : undefined,
          );
          selectDatePart(input, next);
          onPrecisionChange(next);
          pointerFocus.current = false;
          onClick?.(event);
        }}
        onFocus={(event) => {
          // Pointer focus must leave the caret intact until the clicked part is identified.
          if (!pointerFocus.current)
            selectDatePart(event.currentTarget, precision);
          onFocus?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const count = [...event.currentTarget.value.matchAll(/\d+/g)]
              .length;
            const index =
              DATE_PARTS.indexOf(precision) +
              (event.key === "ArrowLeft" ? -1 : 1);
            const next = DATE_PARTS[Math.max(0, Math.min(index, count, 2))];
            selectDatePart(event.currentTarget, next);
            onPrecisionChange(next);
            return;
          }
          onKeyDown?.(event);
        }}
        onPointerCancel={() => {
          pointerFocus.current = false;
        }}
        onPointerDown={() => {
          pointerFocus.current = true;
        }}
        ref={(input) => {
          inputRef.current = input;
          if (typeof ref === "function") ref(input);
          else if (ref) ref.current = input;
        }}
        value={value}
      />
    );
  },
);

function clickedDatePart(
  input: HTMLInputElement,
  clientX?: number,
): DatePrecision {
  const parts = [...input.value.matchAll(/\d+\D*/g)];
  let index = -1;
  const context =
    clientX === undefined
      ? null
      : document.createElement("canvas").getContext("2d");
  if (context && clientX !== undefined) {
    const style = getComputedStyle(input);
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const position =
      clientX -
      input.getBoundingClientRect().left -
      parseFloat(style.borderLeftWidth) -
      parseFloat(style.paddingLeft) +
      input.scrollLeft;
    const letterSpacing = parseFloat(style.letterSpacing) || 0;
    // Include the separator or unit in the clickable segment.
    index = parts.findIndex((part) => {
      const end = part.index + part[0].length;
      return (
        position <
        context.measureText(input.value.slice(0, end)).width +
          end * letterSpacing
      );
    });
  } else {
    const position = input.selectionStart ?? 0;
    index = parts.findIndex((part) => position <= part.index + part[0].length);
  }
  return DATE_PARTS[index < 0 ? Math.min(parts.length, 2) : index];
}

function selectDatePart(input: HTMLInputElement, precision: DatePrecision) {
  const part = [...input.value.matchAll(/\d+/g)][DATE_PARTS.indexOf(precision)];
  const start = part?.index ?? input.value.length;
  input.setSelectionRange(start, start + (part?.[0].length ?? 0));
}

function updateDatePart(
  date: Date,
  precision: DatePrecision,
  previous: string,
): string {
  const previousParts = previous.split("-");
  const count = Math.max(
    previous ? previousParts.length : 0,
    DATE_PARTS.indexOf(precision) + 1,
  );
  const year = date.getFullYear();
  const month =
    precision === "year" && previousParts[1]
      ? Number(previousParts[1]) - 1
      : date.getMonth();
  const day =
    precision !== "day" && previousParts[2]
      ? Number(previousParts[2])
      : date.getDate();
  const result = new Date(date);
  result.setFullYear(year, month + 1, 0);
  // Keep the other parts when editing, clamping dates such as February 29 in a non-leap year.
  result.setFullYear(year, month, Math.min(day, result.getDate()));
  return formatDateValue(result, DATE_PARTS[count - 1]);
}

function toLocalDate(value: string): Date {
  const [year, month = 1, day = 1] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDateValue(date: Date, precision: DatePrecision): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return precision === "year"
    ? year
    : precision === "month"
      ? `${year}-${month}`
      : `${year}-${month}-${day}`;
}

function displayDateValue(value: string, locale: UiLocale): string {
  if (locale === "en") return value;
  return value.split("-").map((part, index) =>
    `${index === 0 ? part : Number(part)}${DATE_UNITS[index]}`,
  ).join("");
}
