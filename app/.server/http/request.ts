import { HttpError } from "@/lib/http";

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

    throw new HttpError(400, `Missing ${headerName} header`);
  }

  const parsed = /^\d+$/u.test(value) ? Number(value) : NaN;

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new HttpError(400, `Invalid ${headerName} header`);
  }

  return parsed;
}

export function readContentType(request: Request): string {
  return request.headers.get("content-type") ?? "application/octet-stream";
}

export function parsePositiveId(value: string, label = "id", message = `Invalid ${label}`): number {
  if (!/^[1-9]\d*$/.test(value)) throw new HttpError(400, message);
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new HttpError(400, message);
  return id;
}

export async function readJsonObject(
  request: Request,
  errorMessage: string,
  options: { maximumBytes?: number; requireJsonContentType?: boolean; fatalUtf8?: boolean } = {},
): Promise<Record<string, unknown>> {
  if (options.requireJsonContentType && !request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "需要 JSON 请求");
  let value: unknown;
  try {
    value = options.maximumBytes === undefined ? await request.json()
      : JSON.parse(new TextDecoder("utf-8", { fatal: options.fatalUtf8 }).decode(await readRequestBody(request, options.maximumBytes)));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON body");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, errorMessage);
  }
  return value as Record<string, unknown>;
}

export async function readRequestBody(request: Request, maximum: number): Promise<ArrayBuffer> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) throw new HttpError(413, "请求过大。");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "请求为空。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new HttpError(413, "请求过大。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes.buffer;
}
