import { translate } from "@/lib/i18n/core";
import { requireBootstrapAdminPage } from "@/app/.server/auth/authorize";
import { runtimeContext } from "@/app/.server/router-context";
import { listResources } from "@/app/.server/resources/data";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import {
  type LoaderFunctionArgs,
  type MetaFunction,
  useLoaderData,
} from "react-router";
import { ResourceManager } from "./manager";
export async function loader({ context }: LoaderFunctionArgs) {
  const rt = context.get(runtimeContext);
  await requireBootstrapAdminPage(rt, "/admin/resources");
  return { locale: rt.uiLocale, resources: await listResources(rt, true) };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.resources.title"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};
export default function AdminResources() {
  return (
    <ResourceManager resources={useLoaderData<typeof loader>().resources} />
  );
}
