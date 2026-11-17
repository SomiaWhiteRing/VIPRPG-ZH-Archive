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
    ![value.topicId, value.postNumber].every(
      (id) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)),
    )
  )
    throwNotFound();
  let href;
  try {
    href = (
      await forumLocation(getForumRuntime(runtime), Number(value.topicId), {
        postNumber: Number(value.postNumber),
      })
    ).href;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      if (hasPermission(await getCurrentUser(runtime), "forum.content.moderate_any")) {
        const post = await runtime.db.prepare("SELECT id FROM forum_posts WHERE topic_id=? AND post_number=?")
          .bind(Number(value.topicId), Number(value.postNumber)).first<{ id: number }>();
        if (post) redirectToForum(forumHistoryHref(Number(value.postNumber) === 1
          ? { kind: "topic", id: Number(value.topicId) } : { kind: "post", id: post.id }));
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
