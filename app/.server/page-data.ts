/** Explicit projection at the loader boundary; values outside keys never reach hydration data. */
export function pickPageFields<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Pick<T, K>;
export function pickPageFields<T extends object, K extends keyof T>(
  value: T | null,
  keys: readonly K[],
): Pick<T, K> | null;
export function pickPageFields<T extends object, K extends keyof T>(
  value: T | null,
  keys: readonly K[],
): Pick<T, K> | null {
  if (value === null) return null;
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>;
}
