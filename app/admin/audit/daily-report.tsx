import { Link } from "react-router";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Label } from "@/app/components/ui/label";
import { Pane } from "@/app/components/ui/pane";
import { SelectField } from "@/app/components/ui/select";
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
  const latestDate = dates[0]?.reportDate;
  const findingCount = summary ? Object.values(summary.findingCounts).reduce((sum, count) => sum + (count ?? 0), 0) : 0;
  return <Pane heading="每日编辑审计报告">
    <p className="mb-3 text-sm text-muted">每天香港时间 09:00 汇总前一天 00:00–24:00 的审计日志。规则命中是复核线索，是否恶意仍需核对具体内容。</p>
    {!latestDate || latestDate < expectedDate ? <p className="mb-3 text-sm font-semibold text-danger">
      {expectedDate} 的日报尚未生成，请检查定时任务；不能据此判断当日编辑是否正常。
    </p> : null}
    {dates.length ? <form action="/admin/audit" method="get" className="mb-4 flex flex-wrap items-end gap-2">
      <Label className="grid gap-1 text-xs font-semibold text-muted">报告日期
        <SelectField aria-label="报告日期" name="reportDate" defaultValue={report?.reportDate ?? latestDate}
          key={report?.reportDate ?? latestDate}
          options={dates.map((date) => ({ value: date.reportDate, label: `${date.reportDate}（${STATUS[date.status]}）` }))} />
      </Label>
      <Button type="submit">查看日报</Button>
    </form> : <EmptyState title="暂无日报。部署并启用定时任务后，每天自动保存。" />}
    {report ? <div className="grid gap-3">
      <p className="text-sm">{report.reportDate} · {STATUS[report.status]} · 生成于 {formatDate(report.generatedAt)}</p>
      <div className="flex flex-wrap items-center gap-3">
        <a className={buttonVariants({ variant: "neutral", size: "sm" })}
          href={`/api/admin/audit/reports/${report.reportDate}/export`} download={`viprpg-audit-${report.reportDate}.jsonl`}>导出给 Agent 分析</a>
        <span className="text-xs text-muted">JSONL 文件包含日报与范围内全部原始日志、修改前后快照和授权记录。</span>
      </div>
      {report.status === "failed" ? <p className="text-sm text-danger">生成失败，下一次定时任务会重试。此次没有可用于判断编辑风险的报告。</p> : null}
      {summary ? <>
        <p className="text-sm">审计日志 {summary.totalLogs} 条，已扫描 {summary.scannedLogs} 条；资料编辑 {summary.entityEdits} 次，字段变化 {summary.changedFields} 处；完整追溯 {summary.completeSnapshots} 次，证据不足 {summary.incompleteEdits} 次；账户角色／权限变更 {summary.authorizationChanges} 次。</p>
        <p className="text-sm text-muted">涉及条目：{Object.entries(summary.targetCounts).map(([type, count]) => `${AUDIT_TARGET_LABELS[type as keyof typeof AUDIT_TARGET_LABELS]} ${count}`).join("、")}。</p>
        <p className="text-sm font-semibold">{report.status === "incomplete"
          ? "核查不完整，无法给出当日风险结论。"
          : findingCount ? `发现 ${findingCount} 条需要复核的线索。` : "已扫描日志未命中当前复核规则，仍不能证明不存在恶意编辑。"}</p>
        {summary.scannedLogs < summary.totalLogs ? <p className="text-sm text-danger">当日日志超出扫描上限或扫描记录发生变化，请到系统审计日志核查剩余记录。</p> : null}
        {summary.actors.length ? <details><summary className="cursor-pointer text-sm">操作者编辑汇总（最多列出前 100 名）</summary>
          <TableWrap compact label="操作者编辑汇总" minWidth={600}>
            <thead><tr><th>操作者</th><th>编辑次数</th><th>涉及条目</th><th>记录</th></tr></thead>
            <tbody>{summary.actors.map((actor, index) => <tr key={`${actor.userId}:${index}`}>
              <td>{actor.name}{actor.userId ? ` #${actor.userId}` : ""}</td><td>{actor.edits}</td><td>{actor.targets}</td>
              <td>{actor.userId ? <Link className="text-primary hover:underline" to={`/admin/audit?q=${actor.userId}`}>操作者日志</Link> : "身份未记录"}</td>
            </tr>)}</tbody>
          </TableWrap>
        </details> : null}
        {findingCount ? <p className="text-xs text-muted">{Object.entries(summary.findingCounts).map(([kind, count]) => `${FINDINGS[kind as AuditReportFinding["kind"]]} ${count}`).join(" · ")}</p> : null}
        {summary.findings.length ? <TableWrap compact label="每日审计复核线索" minWidth={880}>
          <thead><tr><th>类型</th><th>操作者</th><th>线索与条目</th><th>原始记录</th></tr></thead>
          <tbody>{summary.findings.map((finding, index) => <tr key={index}>
            <td>{FINDINGS[finding.kind]}</td><td>{finding.actorName}{finding.actorUserId ? ` #${finding.actorUserId}` : ""}</td>
            <td className="max-w-xl whitespace-pre-wrap wrap-anywhere">
              <p>{finding.message}</p>
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">{finding.targets.map((target) => <li key={`${target.type}:${target.id}`}>
                <Link className="text-primary hover:underline" to={entityAuditTargetHref(target)}>{AUDIT_TARGET_LABELS[target.type]} {target.name ?? ""} #{target.id}</Link>
              </li>)}</ul>
            </td>
            <td><ul className="flex flex-wrap gap-2">{finding.logIds.map((id) => <li key={id}>
              <Link className="text-primary hover:underline" to={`/admin/audit?logId=${id}#audit-log-${id}`}>#{id}</Link>
            </li>)}</ul></td>
          </tr>)}</tbody>
        </TableWrap> : null}
        {summary.omittedFindings ? <p className="text-sm text-muted">另有 {summary.omittedFindings} 条线索未展开；上方统计包含全部已扫描线索。每条集中编辑线索最多列出 20 个日志引用和 10 个条目。</p> : null}
      </> : null}
    </div> : dates.length ? <p className="text-sm text-muted">所选日期没有已保存的日报。</p> : null}
    <details className="mt-3 text-sm text-muted"><summary className="cursor-pointer">核查范围与规则</summary>
      <p className="mt-2">资料删除／合并、主要字段清空、80 字以上文本缩减至少 80%、新增外链域名、授权快照异常、账户角色／权限调整、同一操作者每天至少 30 次编辑或涉及 15 个条目、同一条目每天至少 5 次改写。正常整理也可能命中。</p>
      <p className="mt-2">每天最多扫描 5,000 条日志，最多展开 200 条线索。仅覆盖已有审计日志，未记录的直接数据库改动及内容语义中的恶意无法由这些规则确认。</p>
      <Link className={buttonVariants({ variant: "ghost", size: "sm" })} to="/admin/audit">查看系统审计日志</Link>
    </details>
  </Pane>;
}
