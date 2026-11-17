import { requireBootstrapAdminPage } from "@/app/.server/auth/authorize";
import { runtimeContext } from "@/app/.server/router-context";
import { getEditor } from "@/app/.server/resources/data";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import {
  type LoaderFunctionArgs,
  type MetaFunction,
  useLoaderData,
} from "react-router";
import { ResourceEditor } from "./editor";
import { translate } from "@/lib/i18n/core";
export async function loader({ context, params }: LoaderFunctionArgs) {
  const rt = context.get(runtimeContext);
  await requireBootstrapAdminPage(rt, `/admin/resources/${params.id}`);
  return { data: await getEditor(rt, params.id ?? ""), locale: rt.uiLocale };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({
    title: [loaderData?.data.resource.name ?? translate(locale, "core.nav.resources"), translate(locale, "admin.characterIndex.console")],
  }, error, locale);
};
export default function AdminResource() {
  const { data } = useLoaderData<typeof loader>();
  return <ResourceEditor key={data.resource.id} initial={data} />;
}
