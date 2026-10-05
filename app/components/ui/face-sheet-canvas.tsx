import { cn } from "@/lib/ui/cn";
import type { DragEvent, ReactElement } from "react";

const GRID_COLUMNS = [
  "",
  "grid-cols-1",
  "grid-cols-2",
  "grid-cols-3",
  "grid-cols-4",
];
const GRID_ROWS = [
  "",
  "grid-rows-1",
  "grid-rows-2",
  "grid-rows-3",
  "grid-rows-4",
];

export function FaceSheetCanvas({
  blobSha256,
  height,
  label,
  onSelectCell,
  scale = 2,
  selectedCell,
  cellState,
  renderCell,
  disabled = false,
  fit = false,
  fillWidth = false,
  onDragCell,
  onDragEnd,
  src,
  width,
}: {
  blobSha256?: string;
  height: number;
  label: string;
  onSelectCell: (row: number, column: number) => void;
  scale?: number;
  selectedCell?: { row: number; column: number } | null;
  cellState?: (
    row: number,
    column: number,
  ) => {
    selected?: boolean;
    collected?: boolean;
    highlighted?: boolean;
    disabled?: boolean;
  };
  disabled?: boolean;
  renderCell?: (row: number, column: number, button: ReactElement) => ReactElement;
  fit?: boolean;
  fillWidth?: boolean;
  onDragCell?: (
    row: number,
    column: number,
    event: DragEvent<HTMLButtonElement>,
  ) => void;
  onDragEnd?: () => void;
  src?: string;
  width: number;
}) {
  const rows = height / 48;
  const columns = width / 48;

  return (
    <div
      aria-label={label}
      className={cn("relative shrink-0 overflow-hidden border border-foreground/30 bg-card [image-rendering:pixelated]", (fit || fillWidth) && "max-w-full")}
      role="group"
      style={{
        width: fillWidth ? "100%" : width * scale,
        ...(fit || fillWidth
          ? { aspectRatio: `${width} / ${height}` }
          : { height: height * scale }),
      }}
    >
      <img
        alt=""
        className="block h-full w-full select-none"
        draggable={false}
        height={height}
        src={src ?? `/api/media/blobs/${blobSha256}`}
        width={width}
        loading="lazy"
      />
      <div
        className={cn(
          "absolute inset-0 grid",
          GRID_COLUMNS[columns],
          GRID_ROWS[rows],
        )}
      >
        {Array.from({ length: rows * columns }, (_, index) => {
          const row = Math.floor(index / columns);
          const column = index % columns;
          const selected =
            selectedCell?.row === row && selectedCell.column === column;
          const state = cellState?.(row, column);
          const button = (
            <button
              aria-label={`第 ${row + 1} 行，第 ${column + 1} 列${state?.collected ? "，已添加" : ""}`}
              aria-pressed={selected || !!state?.selected}
              disabled={disabled || state?.disabled}
              draggable={!!onDragCell && !disabled && !state?.disabled}
              onDragStart={
                onDragCell
                  ? (event) => onDragCell(row, column, event)
                  : undefined
              }
              onDragEnd={onDragEnd}
              className={cn(
                "cursor-pointer border border-white/20 bg-transparent hover:border-2 hover:border-emerald-400 hover:bg-emerald-400/15 focus-visible:z-10 focus-visible:border-2 focus-visible:border-accent focus-visible:outline-none",
                (selected || state?.selected) &&
                  "border-2 border-emerald-500 bg-emerald-400/20",
                state?.highlighted &&
                  "z-10 ring-2 ring-inset ring-primary bg-primary/20",
                "relative disabled:cursor-default",
              )}
              key={`${row}:${column}`}
              onClick={() => onSelectCell(row, column)}
              type="button"
            >
              {state?.collected ? (
                <span
                  aria-hidden
                  className="absolute right-0.5 top-0.5 grid size-3.5 place-items-center rounded-full bg-primary text-[10px] leading-none text-primary-foreground"
                >
                  ✓
                </span>
              ) : null}
            </button>
          );
          return renderCell ? renderCell(row, column, button) : button;
        })}
      </div>
    </div>
  );
}
