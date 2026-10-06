import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/app/components/ui/page-header";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { AdminListMeta } from "@/app/admin/admin-list-controls";
import { Badge } from "@/app/components/ui/badge";
import { EmptyState } from "@/app/components/ui/empty-state";
import { TableWrap } from "@/app/components/ui/table-wrap";
import type { ResourceRecord, ResourceEditorData } from "@/lib/resources";
import { postJson, requestJsonValue as requestJson } from "@/lib/ui/api-response";
export function ResourceManager({
  resources,
}: {
  resources: ResourceRecord[];
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{
    issues: { key: string; issue: string }[];
    nextCursor: string | null;
    scanned: number;
    phase: string;
  } | null>(null);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const data = await postJson<ResourceEditorData>(
        "/api/admin/resources",
        Object.fromEntries(form),
      );
      toast.success("链接草稿已创建。");
      window.location.assign(`/admin/resources/${data.resource.id}`);
    } catch (error) {
      toast.error(String(error instanceof Error ? error.message : error));
      setBusy(false);
    }
  }
  async function inspect(cursor?: string | null) {
    setBusy(true);
    try {
      setReport(
        await requestJson(
          `/api/admin/resources/storage${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        ),
      );
    } catch (error) {
      toast.error(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <PageHeader compact title="链接管理" />
      <AdminListMeta total={resources.length} noun="链接" />
      {resources.length ? <TableWrap compact label="链接列表" minWidth={760}>
        <thead><tr><th>名称</th><th>类型</th><th>状态</th><th>顺序</th><th className="admin-action-column">操作</th></tr></thead>
        <tbody>{resources.map((resource) => <tr key={resource.id}>
          <td><Link className="admin-cell-title" to={`/admin/resources/${resource.id}`}>{resource.name}</Link>
            <span className="admin-cell-meta font-mono">{resource.slug}</span></td>
          <td>{resource.kind === "tool" ? "软件" : "网站"}</td>
          <td><Badge variant={resource.visibility === "published" ? "positive" : resource.visibility === "hidden" ? "negative" : "pending"}>
            {{ draft: "草稿", published: "公开", hidden: "隐藏" }[resource.visibility]}
          </Badge></td>
          <td className="tabular-nums">{resource.sort_order}</td>
          <td className="admin-action-column"><Button asChild variant="ghost" size="sm"><Link to={`/admin/resources/${resource.id}`}>编辑</Link></Button></td>
        </tr>)}</tbody>
      </TableWrap> : <EmptyState title="暂无链接。" />}
      <details className="admin-panel admin-details">
      <summary>新增链接</summary>
      <form
        onSubmit={create}
        aria-busy={busy}
        className="mt-4 grid gap-4 sm:grid-cols-2"
      >
        <div className="admin-field">
        <Label htmlFor="resource-name">名称</Label>
        <Input id="resource-name" name="name" maxLength={100} required />
        </div>
        <div className="admin-field">
        <Label htmlFor="resource-slug">固定名称（创建后不可修改）</Label>
        <Input
          id="resource-slug"
          name="slug"
          maxLength={80}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="例如 windy-translator"
          required
        />
        </div>
        <div className="admin-field">
        <Label htmlFor="resource-kind">类型</Label>
        <SelectField
          id="resource-kind"
          name="kind"
          defaultValue="website"
          options={[
            { value: "website", label: "站外网站" },
            { value: "tool", label: "软件" },
          ]}
        />
        </div>
        <div className="flex items-end"><Button disabled={busy}>
          创建草稿
        </Button></div>
      </form>
      </details>
      <details className="admin-panel admin-details">
        <summary>安装包存储检查</summary>
        <div className="mt-4 grid gap-3">
        <Button
          variant="outline"
          className="justify-self-start"
          disabled={busy}
          onClick={() => void inspect()}
        >
          开始检查
        </Button>
        {report ? (
          <>
            <p className="text-sm">
              {report.phase}：本页检查 {report.scanned} 项。
            </p>
            {report.issues.map((issue, i) => (
              <p key={i} className="break-all text-sm">
                {issue.key}：{issue.issue}
              </p>
            ))}
            {!report.issues.length ? (
              <p className="text-sm">本页未发现异常。</p>
            ) : null}
            {report.nextCursor ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void inspect(report.nextCursor)}
              >
                检查下一页
              </Button>
            ) : null}
          </>
        ) : null}
        </div>
      </details>
    </main>
  );
}
