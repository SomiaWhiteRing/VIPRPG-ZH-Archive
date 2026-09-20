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
import { ResourceContent } from "./content";
import { resourceLinks } from "@/lib/resources";

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors(
    {
      title: "链接",
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
      <PageHeader compact title="链接" />
      <div className="mt-6 grid gap-x-6 gap-y-6 sm:mt-7 sm:gap-y-8 lg:grid-cols-2">
        {resources.map((resource) => (
          <ResourceEntry
            key={resource.id}
            id={resource.slug}
            title={resource.name}
            iconSrc={`/api/media/blobs/${resource.icon_blob_sha256}`}
            sourceUrl={resource.kind === "tool" ? resource.source_url : undefined}
            actions={
              <>
                {resource.kind === "tool" ? (
                  <>
                  {resource.downloads.map((download, index) => (
                    <ResourceAction
                      key={download.id}
                      download
                      secondary={index > 0}
                      href={`/api/tool-artifacts/${download.id}/download`}
                    >
                      {download.target === "windows-x64"
                        ? resource.windows_button_label
                        : resource.android_button_label}
                    </ResourceAction>
                  ))}
                  {!resource.downloads.length ? (
                    <span className="text-sm text-muted">暂未提供下载</span>
                  ) : null}
                  </>
                ) : null}
                {resourceLinks(resource).map((link, index) => (
                  <ResourceAction key={index} href={link.url}>
                    {link.label}
                  </ResourceAction>
                ))}
              </>
            }
          >
            <ResourceContent value={resource.summary_json} />
          </ResourceEntry>
        ))}
      </div>
      {!resources.length ? (
        <p className="py-8 text-muted">暂无公开链接。</p>
      ) : null}
    </PageContainer>
  );
}
