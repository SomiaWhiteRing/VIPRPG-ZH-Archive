import { getForumRuntime } from "@/app/.server/forum/context";
import { forumLocation } from "@/app/.server/forum/location";
import { redirectPage, throwNotFound } from "@/app/.server/http/page-response";
import { routeInput } from "@/app/.server/route-input";
import { runtimeContext } from "@/app/.server/router-context";
import { HttpError } from "@/lib/http";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);
  const { params } = routeInput(args);

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
    if (error instanceof HttpError && error.status === 404) throwNotFound();
    throw error;
  }
  redirectPage(href);

  return {};
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: "讨论版" }, error);

export default function Permalink() {
  return null;
}

export { default as ErrorBoundary } from "@/app/discussions/error";
