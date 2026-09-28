import { HttpError } from "@/lib/http";
import { normalizeWorkGenre } from "@/lib/work-genre";

export function parseWorkGenre(value: unknown) {
  try {
    return normalizeWorkGenre(value);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "类型不合法。");
  }
}
