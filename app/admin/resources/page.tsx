import { requireBootstrapAdminPage } from "@/app/.server/auth/authorize";
import { runtimeContext } from "@/app/.server/router-context";
import { listResources } from "@/app/.server/resources/data";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import {
  type LoaderFunctionArgs,
  type MetaFunction,
  useLoaderData,
} from "react-router";
import { ResourceManager } from "./manager";
export async function loader({ context }: LoaderFunctionArgs) {
  const rt = context.get(runtimeContext);
  await requireBootstrapAdminPage(rt, "/admin/resources");
  return { resources: await listResources(rt, true) };
}
export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["资源", "控制台"] }, error);
export default function AdminResources() {
  return (
    <ResourceManager resources={useLoaderData<typeof loader>().resources} />
  );
}
