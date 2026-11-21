export function stringParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export type WorkCreditSort = "upload" | "release";

export function parseWorkCreditSort(value: string | null): WorkCreditSort {
  return value === "release" ? "release" : "upload";
}
