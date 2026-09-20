import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "@/app/components/ui/page-header";
import { Button } from "@/app/components/ui/button";
import { Notice } from "@/app/components/ui/notice";
import { useToast } from "@/app/components/ui/toast";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import type { ResourceRecord, ResourceEditorData } from "@/lib/resources";
import { postJson, requestJson } from "./client";
export function ResourceManager({
  resources,
}: {
  resources: ResourceRecord[];
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false),
    [createError, setCreateError] = useState("");
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
    setCreateError("");
    try {
      const data = await postJson<ResourceEditorData>(
        "/api/admin/resources",
        Object.fromEntries(form),
      );
      toast.success("链接草稿已创建。");
      await navigate(`/admin/resources/${data.resource.id}`);
    } catch (error) {
      setCreateError(String(error instanceof Error ? error.message : error));
    } finally {
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
      <div className="grid gap-2">
        {resources.map((r) => (
          <Link
            key={r.id}
            to={`/admin/resources/${r.id}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-4"
          >
            <span className="font-bold">{r.name}</span>
            <span className="text-sm text-muted">
              {r.kind === "tool" ? "软件" : "网站"} · 顺序 {r.sort_order} ·{" "}
              {
                { draft: "草稿", published: "公开", hidden: "隐藏" }[
                  r.visibility
                ]
              }
            </span>
          </Link>
        ))}
      </div>
      <form
        onSubmit={create}
        className="grid gap-3 rounded-md border border-border bg-card p-4"
      >
        <h2 className="text-lg font-bold">新增链接</h2>
        <Label htmlFor="resource-name">名称</Label>
        <Input id="resource-name" name="name" maxLength={100} required />
        <Label htmlFor="resource-slug">固定名称（创建后不可修改）</Label>
        <Input
          id="resource-slug"
          name="slug"
          maxLength={80}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="例如 windy-translator"
          required
        />
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
        {createError ? <Notice>{createError}</Notice> : null}
        <Button disabled={busy} className="justify-self-start">
          创建草稿
        </Button>
      </form>
      <section className="grid gap-3 rounded-md border border-border p-4">
        <h2 className="text-lg font-bold">安装包存储检查</h2>
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
      </section>
    </main>
  );
}
