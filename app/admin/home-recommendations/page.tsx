import { requireBootstrapAdminPage } from "@/app/.server/auth/authorize";
import { readHomeRecommendations } from "@/app/.server/db/home-recommendations";
import { runtimeContext } from "@/app/.server/router-context";
import { PageHeader } from "@/app/components/ui/page-header";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { HomeRecommendationsEditor } from "./editor";

export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  await requireBootstrapAdminPage(runtime, "/admin/home-recommendations");
  return { works: await readHomeRecommendations(runtime) };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["站长推荐", "控制台"] }, error);

export default function HomeRecommendationsPage() {
  const { works } = useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader compact title="站长推荐" subtitle="选择从中随机展示的游戏。" />
      <HomeRecommendationsEditor initialWorks={works} />
    </main>
  );
}
