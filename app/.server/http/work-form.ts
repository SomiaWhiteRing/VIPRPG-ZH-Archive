import { HttpError } from "@/lib/http";

export function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${field} 不能为空`, undefined, "upload.metadata.error.requiredField", { field });
  }
  return value.trim();
}

export function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new HttpError(400, "文本字段格式不合法", undefined, "upload.metadata.error.textField");
  return value.trim() || null;
}

export function readList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,，\r\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
