import { FaceSheetCanvas } from "@/app/components/ui/face-sheet-canvas";
import type { ComponentProps, DragEvent, ReactNode } from "react";

type GridSheet = {
  blobSha256: string;
  width: number;
  height: number;
  src?: string;
  label?: string;
};

export function FaceSheetGrid<T extends GridSheet>({
  sheets,
  highlightedBlob,
  disabled = false,
  onSelectCell,
  onDragCell,
  onDragEnd,
  cellState,
  renderFooter,
}: {
  sheets: T[];
  highlightedBlob?: string | null;
  disabled?: boolean;
  onSelectCell: (sheet: T, row: number, column: number) => void;
  onDragCell?: (
    sheet: T,
    row: number,
    column: number,
    event: DragEvent<HTMLButtonElement>,
  ) => void;
  onDragEnd?: () => void;
  cellState?: (
    sheet: T,
    row: number,
    column: number,
  ) => ReturnType<NonNullable<ComponentProps<typeof FaceSheetCanvas>["cellState"]>>;
  renderFooter?: (sheet: T) => ReactNode;
}) {
  return (
    <div className="grid grid-cols-2 content-start items-start gap-2 sm:grid-cols-3 sm:gap-3">
      {sheets.map((sheet) => (
        <div
          key={sheet.blobSha256}
          data-face-sheet={sheet.blobSha256}
          data-highlighted={highlightedBlob === sheet.blobSha256 ? "true" : undefined}
          className="min-w-0 max-w-full"
        >
          <FaceSheetCanvas
            blobSha256={sheet.blobSha256}
            src={sheet.src}
            width={sheet.width}
            height={sheet.height}
            scale={1}
            fit
            label={sheet.label ?? "角色脸图选格"}
            disabled={disabled}
            onSelectCell={(row, column) => onSelectCell(sheet, row, column)}
            onDragCell={
              onDragCell
                ? (row, column, event) => onDragCell(sheet, row, column, event)
                : undefined
            }
            onDragEnd={onDragEnd}
            cellState={cellState ? (row, column) => cellState(sheet, row, column) : undefined}
          />
          {renderFooter?.(sheet)}
        </div>
      ))}
    </div>
  );
}
