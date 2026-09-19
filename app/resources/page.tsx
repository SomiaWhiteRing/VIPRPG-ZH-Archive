import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { listPublicResources } from "@/app/.server/resources/data";
import { runtimeContext } from "@/app/.server/router-context";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import {
  type LoaderFunctionArgs,
  type MetaFunction,
  useLoaderData,
} from "react-router";
import { ResourceAction, ResourceEntry } from "./resource-entry";

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors(
    {
      title: "资源",
      description: "游玩、翻译与了解 VIPRPG 时用得上的工具和网站。",
    },
    error,
  );
export async function loader({ context }: LoaderFunctionArgs) {
  return { resources: await listPublicResources(context.get(runtimeContext)) };
}
export default function ResourcesPage() {
  const { resources } = useLoaderData<typeof loader>();
  return (
    <PageContainer className="pt-5 pb-8 sm:pt-6 sm:pb-10">
      <PageHeader compact title="资源" />
      <div className="mt-6 grid gap-x-6 gap-y-6 sm:mt-7 sm:gap-y-8 lg:grid-cols-2">
        {resources.map((resource) => (
          <ResourceEntry
            key={resource.id}
            id={resource.slug}
            title={resource.name}
            iconSrc={`/api/media/blobs/${resource.icon_blob_sha256}`}
            actions={
              resource.kind === "website" ? (
                <ResourceAction href={resource.website_url}>
                  访问网站
                </ResourceAction>
              ) : (
                <>
                  {resource.downloads.map((download, index) => (
                    <ResourceAction
                      key={download.id}
                      download
                      secondary={index > 0}
                      href={`/api/tool-artifacts/${download.id}/download`}
                    >
                      下载{" "}
                      {download.target === "windows-x64"
                        ? "Windows"
                        : "Android"}{" "}
                      版
                    </ResourceAction>
                  ))}
                  {!resource.downloads.length ? (
                    <span className="text-sm text-muted">暂未提供下载</span>
                  ) : null}
                  <ResourceAction
                    secondary
                    href={`/resources/${resource.slug}`}
                  >
                    版本与说明
                  </ResourceAction>
                </>
              )
            }
          >
            <p className="whitespace-pre-wrap">{resource.summary}</p>
          </ResourceEntry>
        ))}
      </div>
      {!resources.length ? (
        <p className="py-8 text-muted">暂无公开资源。</p>
      ) : null}
    </PageContainer>
  );
}
