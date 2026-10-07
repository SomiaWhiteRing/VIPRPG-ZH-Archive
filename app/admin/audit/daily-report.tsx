import { Link } from "react-router";
import { Badge } from "@/app/components/ui/badge";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { ChipList } from "@/app/components/ui/chip-list";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Label } from "@/app/components/ui/label";
import { Pane } from "@/app/components/ui/pane";
import { SelectField } from "@/app/components/ui/select";
import { StatList } from "@/app/components/ui/stat-list";
import { TableWrap } from "@/app/components/ui/table-wrap";
import { AUDIT_TARGET_LABELS, entityAuditTargetHref } from "@/lib/entity-audit";
import type { AuditReportFinding, DailyAuditReport } from "@/lib/audit-report";
import { formatDate } from "@/lib/format";

const STATUS = { complete: "已生成", incomplete: "核查不完整", failed: "生成失败" };
const FINDINGS: Record<AuditReportFinding["kind"], string> = {
  destructive: "删除／合并", cleared: "内容清空／缩减", links: "外链变化", authorization: "授权核查",
  volume: "集中编辑", repeated: "频繁改写", coverage: "证据不足",
};

export function DailyAuditReportPane({ dates, report, expectedDate }: {
  dates: { reportDate: string; status: DailyAuditReport["status"] }[];
  report: DailyAuditReport | null;
  expectedDate: string;
}) {
  const summary = report?.summary;
  const targetLabel = summary?.version === 2 ? "实际变化条目" : "涉及条目";
  const latestDate = dates[0]?.reportDate;
  const findingCount = summary ? Object.values(summary.findingCounts).reduce((sum, count) => sum + (count ?? 0), 0) : 0;
  return (
    <Pane heading="每日编辑审计报告">
      <div className="grid min-w-0 gap-5">
        <p className="text-sm leading-relaxed text-muted">每天香港时间 09:00 汇总前一天 00:00–24:00 的审计日志。</p>
        {!latestDate || latestDate < expectedDate ? (
          <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm leading-relaxed text-danger">
            {expectedDate} 的日报尚未生成，请检查定时任务；不能据此判断当日编辑是否正常。
          </p>
        ) : null}

        <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
          {dates.length ? (
            <form action="/admin/audit" method="get" className="flex min-w-0 flex-wrap items-end gap-3" aria-label="选择审计日报">
              <Label className="grid min-w-0 gap-2 text-xs font-medium text-muted">
                报告日期
                <SelectField aria-label="报告日期" name="reportDate" defaultValue={report?.reportDate ?? latestDate}
                  key={report?.reportDate ?? latestDate}
                  options={dates.map((date) => ({ value: date.reportDate, label: `${date.reportDate}（${STATUS[date.status]}）` }))} />
              </Label>
              <Button type="submit">查看日报</Button>
            </form>
          ) : <EmptyState title="暂无日报。部署并启用定时任务后，每天自动保存。" />}
          {report ? (
            <a className={buttonVariants({ variant: "neutral" })}
              href={`/api/admin/audit/reports/${report.reportDate}/export`} download={`viprpg-audit-${report.reportDate}.jsonl`}>导出给 Agent 分析</a>
          ) : null}
        </div>

        {report ? (
          <div className="grid min-w-0 gap-5">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span className="font-medium text-foreground">{report.reportDate}</span>
              <Badge variant={report.status === "failed" ? "negative" : report.status === "incomplete" ? "pending" : "neutral"}>{STATUS[report.status]}</Badge>
              <span>生成于 {formatDate(report.generatedAt)}</span>
            </div>
            {report.status === "failed" ? <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm leading-relaxed text-danger">生成失败，下一次定时任务会重试。此次没有可用于判断编辑风险的报告。</p> : null}

            {summary ? (
              <>
                <div className="[&_dd]:text-xl [&_dd]:tabular-nums">
                  <StatList variant="tiles" columns={3} items={[
                    { label: "审计日志", value: <>{summary.totalLogs.toLocaleString("zh-CN")}<p className="mt-1 text-xs font-normal text-muted">已扫描 {summary.scannedLogs.toLocaleString("zh-CN")} 条</p></> },
                    { label: "资料编辑", value: <>{summary.entityEdits.toLocaleString("zh-CN")}<p className="mt-1 text-xs font-normal text-muted">字段变化 {summary.changedFields.toLocaleString("zh-CN")} 处</p></> },
                    { label: "完整追溯", value: summary.completeSnapshots.toLocaleString("zh-CN") },
                    { label: "证据不足", value: summary.incompleteEdits.toLocaleString("zh-CN") },
                    { label: "账户角色／权限变更", value: summary.authorizationChanges.toLocaleString("zh-CN") },
                    { label: "待复核线索", value: findingCount.toLocaleString("zh-CN") },
                  ]} />
                </div>

                <div className="grid gap-2 rounded-md border border-border bg-muted/10 p-4 text-sm leading-relaxed">
                  <p className={`font-semibold ${report.status === "incomplete" ? "text-danger" : ""}`}>{report.status === "incomplete"
                    ? "核查不完整，无法给出当日风险结论。"
                    : findingCount ? `发现 ${findingCount} 条需要复核的线索。` : "已扫描日志未命中当前复核规则，仍不能证明不存在恶意编辑。"}</p>
                  <p className="text-xs text-muted">规则命中是复核线索，是否恶意仍需核对具体内容。</p>
                  {summary.version === 1 ? <p className="text-xs text-muted">此日报按首版规则保存，涉及条目可能包含未变化的关联角色，申请记录也可能被计入编辑或授权变更。</p> : null}
                  {summary.scannedLogs < summary.totalLogs ? <p className="text-danger">当日日志超出扫描上限或扫描记录发生变化，请到系统审计日志核查剩余记录。</p> : null}
                </div>

                <div className="grid gap-2">
                  <h3 className="text-xs font-medium text-muted">{targetLabel}</h3>
                  {Object.values(summary.targetCounts).some((count) => count > 0) ? (
                    <ChipList items={Object.entries(summary.targetCounts).filter(([, count]) => count > 0).map(([type, count]) => ({
                      label: `${AUDIT_TARGET_LABELS[type as keyof typeof AUDIT_TARGET_LABELS]} · ${count}`,
                    }))} />
                  ) : <p className="text-sm text-muted">未记录涉及条目。</p>}
                </div>

                {findingCount ? <ChipList items={Object.entries(summary.findingCounts).filter(([, count]) => count && count > 0).map(([kind, count]) => ({
                  label: `${FINDINGS[kind as AuditReportFinding["kind"]]} · ${count}`,
                }))} /> : null}

                {summary.findings.length ? (
                  <details className="admin-details">
                    <summary>复核线索 · {findingCount} 条</summary>
                    <ol className="mt-4 min-w-0 divide-y divide-border">
                      {summary.findings.map((finding, index) => (
                        <li className="grid min-w-0 gap-3 py-4 first:pt-0 last:pb-0" key={index}>
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            <Badge variant="neutral">{FINDINGS[finding.kind]}</Badge>
                            <span className="min-w-0 wrap-anywhere font-medium">{finding.actorName}{finding.actorUserId ? <span className="ml-2 font-mono text-xs text-muted">#{finding.actorUserId}</span> : null}</span>
                          </div>
                          <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">{finding.message}</p>
                          {finding.targets.length ? (
                            <ul className="grid gap-1 text-xs">
                              {finding.targets.map((target) => (
                                <li className="min-w-0 wrap-anywhere" key={`${target.type}:${target.id}`}>
                                  <Link className="text-primary hover:underline" to={entityAuditTargetHref(target)}>{AUDIT_TARGET_LABELS[target.type]} {target.name ?? ""} #{target.id}</Link>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2 text-xs">
                            <span className="text-muted">原始记录</span>
                            <ul className="flex min-w-0 flex-wrap gap-x-3 gap-y-2">
                              {finding.logIds.map((id) => (
                                <li key={id}><Link className="font-mono text-primary hover:underline" to={`/admin/audit?logId=${id}#audit-log-${id}`}>#{id}</Link></li>
                              ))}
                            </ul>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}
                {summary.omittedFindings ? <p className="text-xs leading-relaxed text-muted">另有 {summary.omittedFindings} 条线索未展开；上方统计包含全部已扫描线索。每条集中编辑线索最多列出 20 个日志引用和 10 个条目。</p> : null}

                {summary.actors.length ? (
                  <details className="admin-details">
                    <summary>操作者编辑汇总 · {summary.actors.length} 人（最多 100 名）</summary>
                    <TableWrap compact label="操作者编辑汇总" minWidth={600}>
                      <thead><tr><th>操作者</th><th>编辑次数</th><th>{targetLabel}</th><th>记录</th></tr></thead>
                      <tbody>{summary.actors.map((actor, index) => <tr key={`${actor.userId}:${index}`}>
                        <td>{actor.name}{actor.userId ? <span className="admin-cell-meta font-mono">#{actor.userId}</span> : null}</td>
                        <td className="tabular-nums">{actor.edits}</td><td className="tabular-nums">{actor.targets}</td>
                        <td>{actor.userId ? <Link className="text-primary hover:underline" to={`/admin/audit?q=${actor.userId}`}>操作者日志</Link> : "身份未记录"}</td>
                      </tr>)}</tbody>
                    </TableWrap>
                  </details>
                ) : null}
              </>
            ) : null}
            <p className="text-xs leading-relaxed text-muted">导出格式：JSONL。包含日报与范围内全部原始日志、修改前后快照和授权记录。</p>
          </div>
        ) : dates.length ? <p className="text-sm text-muted">所选日期没有已保存的日报。</p> : null}

        <details className="admin-details">
          <summary>核查范围与规则</summary>
          <div className="mt-3 grid gap-3 text-sm leading-relaxed text-muted">
            <p>资料删除／合并、主要字段清空、80 字以上文本缩减至少 80%、新增外链域名、授权快照异常、账户角色／权限调整、同一操作者每天至少 30 次编辑或涉及 15 个条目、同一条目每天至少 5 次改写。正常整理也可能命中。</p>
            <p>作品编辑中的关联角色仅在角色主资料实际变化时计入条目数。角色或维护者申请的提交、驳回和撤回不计作资料编辑或授权变更；作品类型组合并同样纳入核查。</p>
            <p>每天最多扫描 5,000 条日志，最多展开 200 条线索。仅覆盖已有审计日志，未记录的直接数据库改动及内容语义中的恶意无法由这些规则确认。</p>
          </div>
        </details>
      </div>
    </Pane>
  );
}
