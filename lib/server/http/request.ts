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

export function parsePositiveId(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("Invalid id");
  }

  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid id");
  }

  return id;
}
