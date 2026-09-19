import { publicDetail } from "@/app/.server/resources/data";
import { runtimeContext } from "@/app/.server/router-context";
import { PageContainer } from "@/app/components/ui/page-container";
import { PageHeader } from "@/app/components/ui/page-header";
import { Button } from "@/app/components/ui/button";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { fileSize, targetLabel } from "@/lib/resources";
import {
  Link,
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
export async function loader({ context, params }: LoaderFunctionArgs) {
  return publicDetail(
    context.get(runtimeContext),
    params.slug ?? "",
    params.releaseId,
  );
}
export const meta: MetaFunction<typeof loader> = ({ loaderData, error }) =>
  pageMetaDescriptors(
    { title: [loaderData?.resource.name ?? "资源", "资源"] },
    error,
  );
export default function ResourceDetail() {
  const { resource, releases, artifacts } = useLoaderData<typeof loader>();
  return (
    <PageContainer className="py-6">
      <Link className="text-sm text-primary" to="/resources">
        ← 资源
      </Link>
      <PageHeader compact title={resource.name} />
      <p className="my-5 whitespace-pre-wrap leading-7">
        {resource.description || resource.summary}
      </p>
      {resource.source_url ? (
        <a className="text-primary underline" href={resource.source_url}>
          项目网站
        </a>
      ) : null}
      <div className="mt-6 grid gap-5">
        {releases.map((release) => (
          <section
            key={release.id}
            className="rounded-md border border-border bg-card p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">
                <Link to={`/resources/${resource.slug}/releases/${release.id}`}>
                  {release.version_label}
                </Link>
              </h2>
              <span className="text-sm text-muted">
                {release.published_at?.slice(0, 10)}
                {release.status === "withdrawn" ? " · 已撤回" : ""}
              </span>
            </div>
            <p className="my-4 whitespace-pre-wrap text-sm leading-6">
              {release.notes || "暂无更新说明。"}
            </p>
            {release.status === "withdrawn" ? (
              <p className="text-sm text-muted">此版本已停止下载。</p>
            ) : (
              <div className="grid gap-3">
                {artifacts
                  .filter((a) => a.release_id === release.id)
                  .map((a) => (
                    <div key={a.id} className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-3">
                        <Button asChild size="sm">
                          <a href={`/api/tool-artifacts/${a.id}/download`}>
                            下载 {targetLabel(a.target)}
                          </a>
                        </Button>
                        <span className="break-all text-sm text-muted">
                          {a.filename} · {fileSize(a.size_bytes)}
                          {resource.downloads.some((d) => d.id === a.id)
                            ? " · 当前推荐"
                            : ""}
                        </span>
                      </div>
                      <details className="text-xs text-muted">
                        <summary className="cursor-pointer">
                          文件校验 SHA-256
                        </summary>
                        <code className="break-all">{a.sha256}</code>
                      </details>
                    </div>
                  ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </PageContainer>
  );
}
