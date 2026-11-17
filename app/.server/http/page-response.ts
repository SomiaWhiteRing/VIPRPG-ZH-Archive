import { redirect } from "react-router";
import { parsePositiveId } from "./request";
import { HttpError } from "@/lib/http";
import { preserveUiLocale } from "@/lib/i18n/locale";

export function parsePageId(value: string): number {
  try {
    return parsePositiveId(value);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    throwNotFound();
  }
}

export function throwNotFound(): never {
  throw new Response(null, { status: 404 });
}
export function redirectPage(location: string, request?: Request): never {
  if (request) {
    const source = new URL(request.url);
    const target = preserveUiLocale(new URL(location, source), source);
    if (source.origin === target.origin) location = target.pathname + target.search + target.hash;
  }
  throw redirect(location, 307);
}
