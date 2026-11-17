import { getForumRuntime } from "@/app/.server/forum/context";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { hasPermission } from "@/lib/authz/permissions";
import { forumHistoryHref } from "@/lib/forum";
import { forumLocation } from "@/app/.server/forum/location";
import { redirectPage, throwNotFound } from "@/app/.server/http/page-response";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { HttpError } from "@/lib/http";
import { translate } from "@/lib/i18n/core";
import { preserveUiLocale } from "@/lib/i18n/locale";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);
  const source = new URL(args.request.url);

  function redirectToForum(href: string): never {
    const target = preserveUiLocale(new URL(href, source), source);
    return redirectPage(target.pathname + target.search + target.hash);
  }

  const value = await params;
  if (
    ![value.topicId, value.commentId].every(
      (id) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)),
    )
  )
    throwNotFound();
  let href;
  try {
    href = (
      await forumLocation(getForumRuntime(runtime), Number(value.topicId), {
        commentId: Number(value.commentId),
      })
    ).href;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      if (hasPermission(await getCurrentUser(runtime), "forum.content.moderate_any") &&
        await runtime.db.prepare("SELECT c.id FROM forum_post_comments c JOIN forum_posts p ON p.id=c.post_id WHERE c.id=? AND p.topic_id=?")
          .bind(Number(value.commentId), Number(value.topicId)).first()) {
        redirectToForum(forumHistoryHref({ kind: "comment", id: Number(value.commentId) }));
      }
      throwNotFound();
    }
    throw error;
  }
  redirectToForum(href);

  return {};
}

export const meta: MetaFunction = ({ error, location, matches }) => {
  const locale = pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "core.nav.discussions") }, error, locale);
};

export default function Permalink() {
  return null;
}

export { default as ErrorBoundary } from "@/app/discussions/error";
