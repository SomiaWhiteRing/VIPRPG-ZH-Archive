import { suggestWorkGenres } from "@/app/.server/db/work-genres";
import type { AppRuntime } from "@/app/.server/runtime";
import { json } from "@/lib/http";
import { WORK_GENRE_MAX_LENGTH } from "@/lib/work-genre";

export async function GET(runtime: AppRuntime, request: Request) {
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (query.length > WORK_GENRE_MAX_LENGTH || /[\r\n]/u.test(query)) {
    return json({ names: [] });
  }
  return json({ names: await suggestWorkGenres(runtime, query) });
}
