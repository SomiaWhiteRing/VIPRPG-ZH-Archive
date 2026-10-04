import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { readHomePage } from "@/app/.server/home-page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { HomeWorkspace } from "@/app/components/home/home-workspace";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";

export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  return { ...await readHomePage(runtime), canonical: `${runtime.origin}/explore` };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors({ title: "探索", alternates: { canonical: loaderData?.canonical } }, error);

export default function ExplorePage() {
  return <HomeWorkspace {...useLoaderData<typeof loader>()} />;
}
