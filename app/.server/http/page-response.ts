import { redirect } from "react-router";
import { parsePositiveId } from "./request";
import { HttpError } from "@/lib/http";

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
export function redirectPage(location: string): never {
  throw redirect(location, 307);
}
