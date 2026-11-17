import { parseAccountPage } from "@/app/.server/auth/account-user";
import { parsePositiveId } from "@/app/.server/http/request";
import { preserveUiLocale } from "@/lib/i18n/locale";
import { redirect, type LoaderFunctionArgs } from "react-router";

export function loader({ params, request }: LoaderFunctionArgs) {
  const id = parsePositiveId(params.id ?? "", "work id");
  const source = new URL(request.url);
  const page = parseAccountPage(source.searchParams.get("page") ?? undefined);
  const target = preserveUiLocale(new URL(`/games/${id}?tab=collections${page > 1 ? `&page=${page}` : ""}#sec-comments`, source), source);
  return redirect(target.pathname + target.search + target.hash);
}
