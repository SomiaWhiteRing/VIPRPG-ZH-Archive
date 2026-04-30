export function sanitizeRedirectPath(
  value: FormDataEntryValue | string | null | undefined,
  fallback = "/",
): string {
  if (typeof value !== "string") {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  return value;
}
