"use client";

import { forwardRef, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import DatePicker from "react-datepicker";
import { zhCN } from "date-fns/locale/zh-CN";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { parseOriginalReleaseDate, type OriginalReleasePrecision } from "@/lib/original-release-date";
import "react-datepicker/dist/react-datepicker.css";
import styles from "./precision-date-picker.module.css";

type DatePrecision = Exclude<OriginalReleasePrecision, "unknown">;
const DATE_FORMATS: Record<DatePrecision, string> = {
  year: "yyyy年",
  month: "yyyy年M月",
  day: "yyyy年M月d日",
};
const DATE_PARTS = ["year", "month", "day"] as const;
const DATE_UNITS = ["年", "月", "日"];
const MIN_DATE = new Date("0001-01-01T00:00:00");
const MAX_DATE = new Date("9999-12-31T00:00:00");

export function PrecisionDatePicker({
  id,
  value,
  onChange,
  placeholder = "选择日期",
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
  const parsed = parseOriginalReleaseDate(value);
  const pickerRef = useRef<DatePicker>(null);
  const [precision, setPrecision] = useState<DatePrecision>("year");
  const selected = parsed?.value ? toLocalDate(parsed.value) : null;
  const displayValue = parsed?.value
    ? parsed.value.split("-").map((part, index) => `${index === 0 ? part : Number(part)}${DATE_UNITS[index]}`).join("")
    : "";

  return (
    <div className="relative min-w-0">
      <DatePicker
        autoComplete="off"
        calendarClassName={styles.calendar}
        chooseDayAriaLabelPrefix="选择"
        customInput={(
          <DateSegmentInput
            className={`${styles.input} cursor-pointer pr-10 caret-transparent`}
            onPrecisionChange={(next) => {
              setPrecision(next);
              pickerRef.current?.setOpen(true);
            }}
            precision={precision}
          />
        )}
        dateFormat={DATE_FORMATS[precision]}
        disabled={disabled}
        disabledDayAriaLabelPrefix="不可选择"
        id={id}
        locale={zhCN}
        maxDate={MAX_DATE}
        minDate={MIN_DATE}
        onChangeRaw={(event, selection) => {
          if (!selection) event?.preventDefault();
        }}
        onSelect={(date) => {
          onChange(date ? updateDatePart(date, precision, parsed?.value ?? "") : "");
          if (date && precision !== "day") {
            setPrecision(precision === "year" ? "month" : "day");
            pickerRef.current?.setFocus();
          }
        }}
        openToDate={selected ?? undefined}
        placeholderText={placeholder}
        popperClassName={styles.popper}
        popperPlacement="bottom-start"
        portalId={`${id}-calendar`}
        ref={pickerRef}
        renderCustomHeader={(header) => (
          <div className="px-2 pb-1">
            <div className="flex items-center justify-between">
              <Button
                aria-label={precision === "day" ? "上个月" : precision === "month" ? "上一年" : "前一组年份"}
                className="size-8"
                disabled={precision === "day" ? header.prevMonthButtonDisabled : header.prevYearButtonDisabled}
                onClick={precision === "day" ? header.decreaseMonth : header.decreaseYear}
                size="icon"
                type="button"
                variant="ghost"
              >
                <ChevronLeft aria-hidden />
              </Button>
              <span aria-live="polite" className="text-sm font-medium">
                {precision === "year" && header.visibleYearsRange
                  ? `${header.visibleYearsRange.startYear} – ${header.visibleYearsRange.endYear}`
                  : `${header.date.getFullYear()}年${precision === "day" ? ` ${header.date.getMonth() + 1}月` : ""}`}
              </span>
              <Button
                aria-label={precision === "day" ? "下个月" : precision === "month" ? "下一年" : "后一组年份"}
                className="size-8"
                disabled={precision === "day" ? header.nextMonthButtonDisabled : header.nextYearButtonDisabled}
                onClick={precision === "day" ? header.increaseMonth : header.increaseYear}
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
      <CalendarDays aria-hidden className="pointer-events-none absolute right-3 top-3 size-4 text-muted" />
    </div>
  );
}

type DateSegmentInputProps = InputHTMLAttributes<HTMLInputElement> & {
  precision: DatePrecision;
  onPrecisionChange: (precision: DatePrecision) => void;
};

const DateSegmentInput = forwardRef<HTMLInputElement, DateSegmentInputProps>(function DateSegmentInput(
  { precision, onPrecisionChange, onClick, onKeyDown, onFocus, onBlur, value, ...props },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pointerFocus = useRef(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && document.activeElement === input) selectDatePart(input, precision);
  }, [precision, value]);

  return (
    <Input
      {...props}
      inputMode="none"
      onBlur={(event) => {
        pointerFocus.current = false;
        onBlur?.(event);
      }}
      onClick={(event) => {
        const input = event.currentTarget;
        const next = clickedDatePart(input, event.detail ? event.clientX : undefined);
        selectDatePart(input, next);
        onPrecisionChange(next);
        pointerFocus.current = false;
        onClick?.(event);
      }}
      onFocus={(event) => {
        // Pointer focus must leave the caret intact until the clicked part is identified.
        if (!pointerFocus.current) selectDatePart(event.currentTarget, precision);
        onFocus?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const count = [...event.currentTarget.value.matchAll(/\d+/g)].length;
          const index = DATE_PARTS.indexOf(precision) + (event.key === "ArrowLeft" ? -1 : 1);
          const next = DATE_PARTS[Math.max(0, Math.min(index, count, 2))];
          selectDatePart(event.currentTarget, next);
          onPrecisionChange(next);
          return;
        }
        onKeyDown?.(event);
      }}
      onPointerCancel={() => { pointerFocus.current = false; }}
      onPointerDown={() => { pointerFocus.current = true; }}
      readOnly
      ref={(input) => {
        inputRef.current = input;
        if (typeof ref === "function") ref(input);
        else if (ref) ref.current = input;
      }}
      value={value}
    />
  );
});

function clickedDatePart(input: HTMLInputElement, clientX?: number): DatePrecision {
  const parts = [...input.value.matchAll(/\d+[年月日]/g)];
  let index = -1;
  const context = clientX === undefined ? null : document.createElement("canvas").getContext("2d");
  if (context && clientX !== undefined) {
    const style = getComputedStyle(input);
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const position = clientX - input.getBoundingClientRect().left
      - parseFloat(style.borderLeftWidth) - parseFloat(style.paddingLeft) + input.scrollLeft;
    const letterSpacing = parseFloat(style.letterSpacing) || 0;
    // Measure the whole number-and-unit segment: caret positions round both sides of a character.
    index = parts.findIndex((part) => {
      const end = part.index + part[0].length;
      return position < context.measureText(input.value.slice(0, end)).width + end * letterSpacing;
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

function updateDatePart(date: Date, precision: DatePrecision, previous: string): string {
  const previousParts = previous.split("-");
  const count = Math.max(previous ? previousParts.length : 0, DATE_PARTS.indexOf(precision) + 1);
  const year = date.getFullYear();
  const month = precision === "year" && previousParts[1] ? Number(previousParts[1]) - 1 : date.getMonth();
  const day = precision !== "day" && previousParts[2] ? Number(previousParts[2]) : date.getDate();
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
  return precision === "year" ? year : precision === "month" ? `${year}-${month}` : `${year}-${month}-${day}`;
}
