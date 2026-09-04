"use client";

import Image from "next/image";
import { cn } from "@/lib/ui/cn";

const GRID_COLUMNS = ["", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"];
const GRID_ROWS = ["", "grid-rows-1", "grid-rows-2", "grid-rows-3", "grid-rows-4"];

export function FaceSheetCanvas({
  blobSha256,
  height,
  label,
  onSelectCell,
  scale = 2,
  selectedCell,
  src,
  width,
}: {
  blobSha256?: string;
  height: number;
  label: string;
  onSelectCell: (row: number, column: number) => void;
  scale?: number;
  selectedCell?: { row: number; column: number } | null;
  src?: string;
  width: number;
}) {
  const rows = height / 48;
  const columns = width / 48;

  return (
    <div
      aria-label={label}
      className="relative shrink-0 overflow-hidden border border-foreground/30 bg-card [image-rendering:pixelated]"
      role="group"
      style={{ height: height * scale, width: width * scale }}
    >
      <Image
        alt=""
        className="block h-full w-full select-none"
        draggable={false}
        height={height}
        src={src ?? `/api/media/blobs/${blobSha256}`}
        unoptimized
        width={width}
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
          const selected = selectedCell?.row === row && selectedCell.column === column;
          return (
            <button
              aria-label={`第 ${row + 1} 行，第 ${column + 1} 列`}
              aria-pressed={selected}
              className={cn(
                "border border-white/20 bg-transparent hover:border-2 hover:border-emerald-400 hover:bg-emerald-400/15 focus-visible:z-10 focus-visible:border-2 focus-visible:border-accent focus-visible:outline-none",
                selected && "border-2 border-emerald-500 bg-emerald-400/20",
              )}
              key={`${row}:${column}`}
              onClick={() => onSelectCell(row, column)}
              type="button"
            />
          );
        })}
      </div>
    </div>
  );
}
