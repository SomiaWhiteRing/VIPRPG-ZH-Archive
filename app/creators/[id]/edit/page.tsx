import { requireAnyPagePermission } from "@/app/.server/auth/authorize";
import { getPublicCreatorDetail } from "@/app/.server/db/creator-library";
import { throwNotFound } from "@/app/.server/http/page-response";
import { parsePositiveId } from "@/app/.server/http/request";
import { runtimeContext } from "@/app/.server/router-context";
import { CREATOR_PUBLIC_EDIT_PERMISSIONS } from "@/lib/authz/creator-permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { CreatorEditor } from "./editor";

export async function loader({ context, params }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  const id = parsePositiveId(params.id ?? "", "creator id");
  await requireAnyPagePermission(runtime, `/creators/${id}/edit`, CREATOR_PUBLIC_EDIT_PERMISSIONS);
  const creator = await getPublicCreatorDetail(runtime, id);
  if (!creator) throwNotFound();
  return { creator: { id: creator.id, name: creator.name, aliases: creator.aliases, links: creator.links, bio: creator.bio, avatarBlobSha256: creator.avatarBlobSha256 } };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: ["编辑作者资料", loaderData?.creator.name || "作者"] }, error);

export default function CreatorEditPage() {
  const { creator } = useLoaderData<typeof loader>();
  return <CreatorEditor key={creator.id} creator={creator} />;
}
