import { parseAccountPage } from "@/app/.server/auth/account-user";
import { parsePositiveId } from "@/app/.server/http/request";
import { redirect, type LoaderFunctionArgs } from "react-router";

export function loader({ params, request }: LoaderFunctionArgs) {
  const id = parsePositiveId(params.id ?? "", "work id");
  const page = parseAccountPage(new URL(request.url).searchParams.get("page") ?? undefined);
  return redirect(`/games/${id}?tab=collections${page > 1 ? `&page=${page}` : ""}#sec-comments`);
}
