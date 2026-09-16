import type { LoaderFunctionArgs } from "react-router";
export function routeInput(args: LoaderFunctionArgs) {
  const url = new URL(args.request.url);
  const searchParams: Record<string, string | string[] | undefined> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    searchParams[key] = values.length > 1 ? values : values[0];
  }
  return { params: args.params as Record<string, string>, searchParams };
}
