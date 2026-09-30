import { requirePagePermission } from "@/app/.server/auth/authorize";
import { getAdminObservability } from "@/app/.server/db/admin-observability";
import { runtimeContext } from "@/app/.server/router-context";
import { runGcDryRun } from "@/app/.server/storage/admin-storage-checks";
import { AdminOperationPanel } from "@/app/admin/admin-operation-panel";
import { buttonVariants } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/ui/page-header";
import { Pane } from "@/app/components/ui/pane";
import { StatList } from "@/app/components/ui/stat-list";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { hasPermission } from "@/lib/authz/permissions";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { formatBytes, formatDate, formatNullableDuration, formatNumber } from "@/lib/format";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

const HEALTH_LINKS = [
  { href: "/api/health", label: "查看运行状态" },
  { href: "/api/health/db", label: "检查数据库连接" },
  { href: "/api/health/r2", label: "检查对象存储连接" },
  { href: "/api/admin/summary", label: "查看管理摘要" },
  { href: "/api/admin/observability", label: "查看观测数据" },
  { href: "/api/admin/consistency", label: "运行一致性检查" },
  { href: "/api/admin/gc/dry-run", label: "运行清理预演" },
];

export async function loader(args: LoaderFunctionArgs) {
  const runtime = args.context.get(runtimeContext);

  const adminUser = await requirePagePermission(
    runtime,
    "/admin/maintenance",
    "system.maintenance.run",
  );
  const canRunFinalCleanup = hasPermission(adminUser, "storage.gc.sweep");

  const [observability, gcDryRun] = await Promise.all([
    getAdminObservability(runtime),
    runGcDryRun(runtime, { sampleLimit: 5 }),
  ]);

  const downloadMetrics: Array<[string, string]> = [
    ["完整 ZIP 输出完成", formatNumber(observability.downloads.fullDownloadCount)],
    ["分段输出完成", formatNumber(observability.downloads.rangeDownloadCount)],
    ["历史成功请求（未细分）", formatNumber(observability.downloads.unclassifiedDownloadCount)],
    ["缓存命中请求", formatNumber(observability.downloads.cacheHitCount)],
    ["缓存未命中请求", formatNumber(observability.downloads.cacheMissCount)],
    ["连接中断 / 取消", formatNumber(observability.downloads.interruptedCount)],
    ["服务端错误", formatNumber(observability.downloads.serverFailureCount)],
    ["历史异常（未分类）", formatNumber(observability.downloads.unclassifiedFailureCount)],
    ["实测 R2 GET 请求", formatNumber(observability.downloads.totalR2GetCount)],
    [
      "整包缓存节省读取（估算）",
      formatNumber(observability.downloads.estimatedR2GetSavedByCache),
    ],
    ["已完成输出字节", formatBytes(observability.downloads.totalBytesServed)],
  ];

  const gcMetrics: Array<[string, string]> = [
    [
      "自动回收旧软件包",
      `${formatNumber(gcDryRun.toolArtifacts.eligibleCount)} / ${formatBytes(gcDryRun.toolArtifacts.eligibleSizeBytes)}`,
    ],
    [
      "可最终清理的文件版本",
      `${formatNumber(gcDryRun.archiveVersions.eligibleCount)} 个快照 / ${formatNumber(gcDryRun.archiveVersions.eligibleFileCount)} 个文件 / ${formatBytes(gcDryRun.archiveVersions.eligibleSizeBytes)}`,
    ],
    [
      "可清理文件对象",
      `${formatNumber(gcDryRun.blobs.eligibleCount)} / ${formatBytes(gcDryRun.blobs.eligibleSizeBytes)}`,
    ],
    [
      "仅回收站引用的文件对象",
      `${formatNumber(gcDryRun.blobs.deletedOnlyReferenceCount)} / ${formatBytes(gcDryRun.blobs.deletedOnlyReferenceSizeBytes)}`,
    ],
    [
      "可清理引擎公共文件",
      `${formatNumber(gcDryRun.corePacks.eligibleCount)} / ${formatBytes(gcDryRun.corePacks.eligibleSizeBytes)}`,
    ],
    [
      "仅回收站引用的引擎公共文件",
      `${formatNumber(gcDryRun.corePacks.deletedOnlyReferenceCount)} / ${formatBytes(gcDryRun.corePacks.deletedOnlyReferenceSizeBytes)}`,
    ],
  ];

  return {
    canRunFinalCleanup, gcDryRun, downloadMetrics, gcMetrics,
    downloadFailures: observability.downloads.recentFailures,
  };
}

export const meta: MetaFunction = ({ error }) =>
  pageMetaDescriptors({ title: ["维护与一致性", "控制台"] }, error);

export default function AdminMaintenancePage() {
  const { canRunFinalCleanup, gcDryRun, downloadMetrics, gcMetrics, downloadFailures } =
    useLoaderData<typeof loader>();
  return (
    <main>
      <PageHeader
        compact
        title="维护与一致性"
        subtitle="先检查当前状态和清理范围，再执行会修改数据的操作。"
      />

      <Pane heading="只读诊断">
        <div className="flex flex-wrap items-center gap-3">
          {HEALTH_LINKS.map((link) => (
            <a
              className={buttonVariants({ variant: "outline" })}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </a>
          ))}
        </div>
      </Pane>

      <section className="grid gap-3 md:grid-cols-2" aria-label="观测摘要">
        <Pane heading="下载观测">
          <p className="text-sm text-muted">
            按请求统计，服务端输出完成不代表用户已保存或安装。
            分类、字节和实测读取从观测升级后累计；历史未分类记录单列。
            分段按实际响应长度计算，输出字节不包含中途断开的部分。
          </p>
          <StatList
            items={downloadMetrics.map(([label, value]) => ({ label, value }))}
          />
        </Pane>

        <Pane heading="清理预演">
          <p className="text-sm text-muted">
            预演不会删除对象。回收站默认保留 {gcDryRun.graceDays} 天。
            旧软件包由定时任务回收，不适用回收站保留天数；最新已发布包和当前推荐包会保留。
          </p>
          <StatList
            items={gcMetrics.map(([label, value]) => ({ label, value }))}
          />
        </Pane>
      </section>

      {downloadFailures.length > 0 ? (
        <Pane heading="最近下载异常">
          <p className="text-sm text-muted">
            显示每个下载记录最后一次异常及累计次数，后续成功会保留异常原因和时间。
            连接中断可能发生在客户端或对象存储一侧，不直接认定为用户主动取消。
          </p>
          <TableWrap compact label="最近下载异常" minWidth={860}>
            <thead>
              <tr>
                <th>版本</th>
                <th>累计异常</th>
                <th>最后异常</th>
                <th>最近结果</th>
              </tr>
            </thead>
            <tbody>
              {downloadFailures.map((download) => (
                <tr key={download.id}>
                  <td>
                    <Link to={`/admin/archive-versions/${download.archiveVersionId}`}>
                      #{download.archiveVersionId} {download.workTitle}
                    </Link>
                    <div className="text-sm text-muted">
                      {download.archiveStatus === "deleted" ? "已删除版本" : download.isCurrent ? "当前版本" : "历史版本"}
                      {" · "}{download.downloadProfile === "web-play" ? "在线游玩" : "ZIP 下载"}
                      {" · "}记录 #{download.id}
                    </div>
                  </td>
                  <td>
                    服务端 {formatNumber(download.serverFailureCount)}
                    <div className="text-sm text-muted">
                      中断 {formatNumber(download.interruptedCount)} · 未分类 {formatNumber(download.unclassifiedFailureCount)}
                    </div>
                  </td>
                  <td>
                    {download.lastFailureKind === "server" ? "服务端错误" : download.lastFailureKind === "interrupted" ? "连接中断 / 取消" : "历史未分类"}
                    <div className="text-sm text-muted">
                      {download.lastFailureAt ? formatDate(download.lastFailureAt) : "异常时间未记录"}
                      {download.lastFailureDurationMs !== null ? ` · ${formatNullableDuration(download.lastFailureDurationMs)}` : ""}
                    </div>
                    <div className="max-w-sm break-words text-sm text-muted">
                      {download.lastErrorMessage ?? "历史原因未保留"}
                    </div>
                  </td>
                  <td>
                    {download.status === "ready" ? "最后请求记录成功" : "最后请求记录异常"}
                    <div className="text-sm text-muted">
                      {download.lastSuccessAt ? `最近成功 ${formatDate(download.lastSuccessAt)}` : download.downloadCount > 0 ? "历史有成功请求，时间未记录" : "尚无成功请求"}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Pane>
      ) : null}

      <Pane heading="执行维护" tone="danger">
        <p className="text-sm">
          最终清理会永久删除已进入清理范围的文件引用和对象，无法撤销。
        </p>
        <AdminOperationPanel canRunFinalCleanup={canRunFinalCleanup} />
      </Pane>
    </main>
  );
}
