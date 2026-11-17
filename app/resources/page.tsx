import { translate } from "@/lib/i18n/core";
import { useMessages } from "@/lib/i18n/react";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { listPublicResources } from "@/app/.server/resources/data";
import { runtimeContext } from "@/app/.server/router-context";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import {
  type LoaderFunctionArgs,
  type MetaFunction,
  useLoaderData,
  useLocation,
} from "react-router";
import { ResourceAction, ResourceEntry } from "./resource-entry";
import { ResourceContent } from "./content";
import { ResourceDownload } from "./resource-download";
import { resourceLinks } from "@/lib/resources";

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({
    title: translate(locale, "core.nav.resources"),
    description: translate(locale, "resources.description"),
  }, error, locale);
};
export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  return { resources: await listPublicResources(runtime), locale: runtime.uiLocale };
}
export default function ResourcesPage() {
  const t = useMessages();
  const { resources } = useLoaderData<typeof loader>();
  const location = useLocation();
  return (
    <PageContainer className="pt-5 pb-8 sm:pt-6 sm:pb-10">
      <PageHeader compact title={t("core.nav.resources")} />
      <div className="mt-6 grid gap-x-6 gap-y-6 sm:mt-7 sm:gap-y-8 lg:grid-cols-2">
        {resources.map((resource) => (
          <ResourceEntry
            key={resource.id}
            id={resource.slug}
            highlightKey={location.hash === `#${resource.slug}` ? location.key : undefined}
            title={resource.name}
            iconSrc={`/api/media/blobs/${resource.icon_blob_sha256}`}
            sourceUrl={resource.kind === "tool" ? resource.source_url : undefined}
            actions={
              <>
                {resource.kind === "tool" ? (
                  <ResourceDownload resource={resource} />
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
        <p className="py-8 text-muted">{t("resources.empty")}</p>
      ) : null}
    </PageContainer>
  );
}
