import { requireBootstrapAdminPage } from "@/app/.server/auth/authorize";
import { runtimeContext } from "@/app/.server/router-context";
import { getEditor } from "@/app/.server/resources/data";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import {
  type LoaderFunctionArgs,
  type MetaFunction,
  useLoaderData,
} from "react-router";
import { ResourceEditor } from "./editor";
export async function loader({ context, params }: LoaderFunctionArgs) {
  const rt = context.get(runtimeContext);
  await requireBootstrapAdminPage(rt, `/admin/resources/${params.id}`);
  return getEditor(rt, params.id ?? "");
}
export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    { title: [loaderData?.resource.name ?? "链接", "控制台"] },
    error,
  );
export default function AdminResource() {
  const data = useLoaderData<typeof loader>();
  return <ResourceEditor key={data.resource.id} initial={data} />;
}
