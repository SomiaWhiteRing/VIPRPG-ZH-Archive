import { HttpError } from "@/lib/http";
import { normalizeWorkReferenceDuration } from "@/lib/work-reference-duration";

export function parseWorkReferenceDuration(value: unknown) {
  try {
    return normalizeWorkReferenceDuration(value);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "参考时长不合法。");
  }
}
