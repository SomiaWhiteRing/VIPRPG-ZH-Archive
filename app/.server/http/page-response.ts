import { redirect } from "react-router";

export function throwNotFound(): never {
  throw new Response(null, { status: 404 });
}
export function redirectPage(location: string): never {
  throw redirect(location, 307);
}
