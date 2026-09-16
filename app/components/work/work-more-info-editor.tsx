import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import type { WorkMoreInfo } from "@/lib/work-more-info";
import {
  MORE_INFO_BODY_MAX_LENGTH,
  MORE_INFO_MAX_ITEMS,
  MORE_INFO_TITLE_MAX_LENGTH,
  moreInfoItemError,
} from "@/lib/work-more-info";
import { useState } from "react";

export type MoreInfoRow = WorkMoreInfo & { id: string };

export function moreInfoRows(items: WorkMoreInfo[]): MoreInfoRow[] {
  return items.map((item, index) => ({ ...item, id: `stored-${index}` }));
}

export function WorkMoreInfoEditor({
  id,
  rows,
  onChange,
  disabled = false,
  showErrors = false,
}: {
  id: string;
  rows: MoreInfoRow[];
  onChange: (rows: MoreInfoRow[]) => void;
  disabled?: boolean;
  showErrors?: boolean;
}) {
  const [invalid, setInvalid] = useState(false);
  function update(rowId: string, patch: Partial<WorkMoreInfo>) {
    onChange(
      rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  }
  return (
    <fieldset
      className="grid min-w-0 gap-2"
      disabled={disabled}
      onInvalidCapture={(event) => {
        setInvalid(true);
        const details = event.currentTarget.closest("details");
        if (details) details.open = true;
      }}
    >
      <legend className="mb-2 text-sm font-bold">更多信息</legend>
      {rows.map((row, index) => {
        const prefix = `${id}-${row.id}`;
        const error = moreInfoItemError(row);
        const visibleError = showErrors || invalid ? error : null;
        return (
          <div
            className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)_auto] items-start gap-2"
            key={row.id}
          >
            <div className="grid min-w-0 gap-1">
              <Label className="sr-only" htmlFor={`${prefix}-title`}>
                标题
              </Label>
              <Input
                id={`${prefix}-title`}
                value={row.title}
                placeholder="标题"
                maxLength={MORE_INFO_TITLE_MAX_LENGTH}
                aria-invalid={visibleError?.field === "title"}
                aria-describedby={
                  visibleError?.field === "title"
                    ? `${prefix}-error`
                    : undefined
                }
                ref={(input) => {
                  input?.setCustomValidity(
                    error?.field === "title" ? error.message : "",
                  );
                }}
                onChange={(event) =>
                  update(row.id, { title: event.target.value })
                }
              />
            </div>
            <div className="grid min-w-0 gap-1">
              <Label className="sr-only" htmlFor={`${prefix}-body`}>
                内容
              </Label>
              <Textarea
                className="h-10 min-h-10 resize-y"
                id={`${prefix}-body`}
                value={row.body}
                placeholder="内容"
                rows={1}
                maxLength={MORE_INFO_BODY_MAX_LENGTH}
                aria-invalid={visibleError?.field === "body"}
                aria-describedby={
                  visibleError?.field === "body" ? `${prefix}-error` : undefined
                }
                ref={(input) => {
                  input?.setCustomValidity(
                    error?.field === "body" ? error.message : "",
                  );
                }}
                onChange={(event) =>
                  update(row.id, { body: event.target.value })
                }
              />
            </div>
            <Button
              className="px-1.5"
              size="sm"
              type="button"
              variant="ghost"
              disabled={disabled}
              aria-label={`移除第 ${index + 1} 条更多信息`}
              onClick={() => {
                onChange(rows.filter((item) => item.id !== row.id));
                requestAnimationFrame(() =>
                  document.getElementById(`${id}-add`)?.focus(),
                );
              }}
            >
              移除
            </Button>
            {visibleError ? (
              <p
                className="col-span-full text-xs text-red-600"
                id={`${prefix}-error`}
                role="alert"
              >
                {visibleError.message}
              </p>
            ) : null}
          </div>
        );
      })}
      <Button
        className="w-fit"
        id={`${id}-add`}
        size="sm"
        type="button"
        variant="ghost"
        disabled={disabled || rows.length >= MORE_INFO_MAX_ITEMS}
        onClick={() => {
          const rowId = crypto.randomUUID();
          onChange([...rows, { id: rowId, title: "", body: "" }]);
          requestAnimationFrame(() =>
            document.getElementById(`${id}-${rowId}-title`)?.focus(),
          );
        }}
      >
        ＋ 添加信息
      </Button>
    </fieldset>
  );
}

export function WorkMoreInfoFields({ items }: { items: WorkMoreInfo[] }) {
  const [rows, setRows] = useState(() => moreInfoRows(items));
  return (
    <>
      <input
        type="hidden"
        name="more_info"
        value={JSON.stringify(rows.map(({ title, body }) => ({ title, body })))}
      />
      <WorkMoreInfoEditor id="admin-more-info" rows={rows} onChange={setRows} />
    </>
  );
}
