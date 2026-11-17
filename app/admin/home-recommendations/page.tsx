import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { requireBootstrapAdminPage } from "@/app/.server/auth/authorize";
import { readHomeRecommendations } from "@/app/.server/db/home-recommendations";
import { runtimeContext } from "@/app/.server/router-context";
import { PageHeader } from "@/app/components/ui/page-header";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { HomeRecommendationsEditor } from "./editor";

export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  await requireBootstrapAdminPage(runtime, "/admin/home-recommendations");
  return { locale: runtime.uiLocale, works: await readHomeRecommendations(runtime) };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: [translate(locale, "admin.dashboard.recommendations"), translate(locale, "admin.characterIndex.console")] }, error, locale);
};

export default function HomeRecommendationsPage() {
  const t = useMessages();
  const { works } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader compact title={t("admin.dashboard.recommendations")} subtitle={t("admin.recommendations.subtitle")} />
      <HomeRecommendationsEditor initialWorks={works} />
    </main>
  );
}
