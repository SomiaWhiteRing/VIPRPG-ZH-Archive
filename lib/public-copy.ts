export function publicCopy(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replaceAll("归档快照", "文件版本")
    .replaceAll("归档容量", "文件大小")
    .replaceAll("归档", "版本");
}
