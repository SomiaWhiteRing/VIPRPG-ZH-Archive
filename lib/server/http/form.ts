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

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return Response.redirect(url, 303);
}
