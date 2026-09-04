import { jsonError, publicErrorDetail } from "@/lib/server/http/json";

export function readRequiredFormString(
  formData: FormData,
  name: string,
): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing ${name}`);
  }

  return value.trim();
}

export function redirectWithParams(
  request: Request,
  path: string,
  params: Record<string, string | null | undefined>,
): Response {
  const url = new URL(path, request.url);

  applySearchParams(url, params);

  return redirectResponse(url);
}

export function redirectResponse(url: URL | string, status = 303): Response {
  return new Response(null, {
    status,
    headers: {
      Location: url.toString(),
    },
  });
}

export function formOrJsonError(
  request: Request,
  fallbackPath: string,
  message: string,
  error: unknown,
): Response {
  if (requestWantsJson(request)) return jsonError(message, error);
  return redirectWithParams(request, fallbackPath, {
    error: publicErrorDetail(error),
  });
}

export function requestWantsJson(request: Request): boolean {
  return request.headers.get("accept")?.toLowerCase().includes("application/json") ?? false;
}

export function applySearchParams(
  url: URL,
  params: Record<string, string | null | undefined>,
): URL {
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}
