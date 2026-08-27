import { HttpError } from "@/lib/server/http/json";

export function readIntegerHeader(
  request: Request,
  headerName: string,
  fallback?: number,
): number {
  const value = request.headers.get(headerName);

  if (value === null) {
    if (fallback !== undefined) {
      return fallback;
    }

    throw new Error(`Missing ${headerName} header`);
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${headerName} header`);
  }

  return parsed;
}

export function readContentType(request: Request): string {
  return request.headers.get("content-type") ?? "application/octet-stream";
}

export function parsePositiveId(value: string, label = "id"): number {
  const message = `Invalid ${label}`;
  if (!/^[1-9]\d*$/.test(value)) throw new HttpError(400, message);
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new HttpError(400, message);
  return id;
}

export async function readJsonObject(
  request: Request,
  errorMessage: string,
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, errorMessage);
  }
  return value as Record<string, unknown>;
}
