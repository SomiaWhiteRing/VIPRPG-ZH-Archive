export function normalizeEntityName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function normalizeCreatorName(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}
