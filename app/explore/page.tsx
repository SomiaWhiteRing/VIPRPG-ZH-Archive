import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { readHomePage } from "@/app/.server/home-page-data";
import { runtimeContext } from "@/app/.server/router-context";
import { HomeWorkspace } from "@/app/components/home/home-workspace";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { translate } from "@/lib/i18n/core";

export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  return { ...await readHomePage(runtime), canonical: `${runtime.origin}/explore`, locale: runtime.uiLocale };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "core.nav.explore"),
    alternates: { canonical: loaderData?.canonical } }, error, locale);
};

export default function ExplorePage() {
  return <HomeWorkspace {...useLoaderData<typeof loader>()} />;
}
