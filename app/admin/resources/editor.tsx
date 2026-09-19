import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/app/components/ui/page-header";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { SelectField } from "@/app/components/ui/select";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  fileSize,
  targetLabel,
  RESOURCE_TARGETS,
  type ResourceEditorData,
  type ToolRelease,
} from "@/lib/resources";
import { PackageUpload } from "./package-upload";
import { postJson, requestJson } from "./client";
const statusLabels = {
  pending: "待上传",
  uploading: "上传中",
  uncertain: "结果待确认",
  ready: "校验完成",
  cleanup: "清理待完成",
  cleaned: "已清理",
};
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-2">
      {label}
      {children}
    </Label>
  );
}
export function ResourceEditor({ initial }: { initial: ResourceEditorData }) {
  const toast = useToast();
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [formKey, setFormKey] = useState(0);
  const { resource } = data,
    base = `/api/admin/resources/${resource.id}`;
  async function run(
    operation: () => Promise<ResourceEditorData>,
    success = "已保存",
  ) {
    if (busy) return;
    setBusy(true);
    try {
      setData(await operation());
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  const action = (values: Record<string, unknown>) =>
    run(() => postJson(base, { revision: resource.revision, ...values }));
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void action({
      action: "save",
      ...Object.fromEntries(form),
      sortOrder: Number(form.get("sortOrder")),
    });
  }
  async function icon(file: File | undefined) {
    if (!file) return;
    await run(
      () =>
        requestJson(base + "/icon", {
          method: "PUT",
          headers: {
            "Content-Type": "image/png",
            "X-Resource-Revision": String(resource.revision),
          },
          body: file,
        }),
      "图标已更新",
    );
  }
  return (
    <main>
      <Link className="text-sm text-primary" to="/admin/resources">
        ← 资源管理
      </Link>
      <PageHeader
        compact
        title={resource.name}
        actions={
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => {
              if (
                window.confirm("重新读取会放弃表单中尚未保存的修改。继续吗？")
              )
                void run(async () => {
                  const next = await requestJson<ResourceEditorData>(base);
                  setFormKey((v) => v + 1);
                  return next;
                }, "已重新读取");
            }}
          >
            重新读取
          </Button>
        }
      />
      <section className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card p-4">
        {resource.icon_blob_sha256 ? (
          <img
            src={`${base}/icon?v=${resource.revision}`}
            alt="资源图标"
            className="size-16 object-contain"
          />
        ) : null}
        <Label className="grid gap-2">
          图标（PNG，最多 512 KiB、边长最多 512px）
          <input
            type="file"
            accept="image/png"
            disabled={busy}
            onChange={(e) => {
              void icon(e.target.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </Label>
      </section>
      <form
        key={`resource-${formKey}`}
        onSubmit={save}
        className="grid gap-4 rounded-md border border-border bg-card p-4"
      >
        <h2 className="text-lg font-bold">资源资料</h2>
        <p className="text-sm text-muted">
          固定名称：{resource.slug} ·{" "}
          {resource.kind === "tool" ? "软件" : "站外网站"}
        </p>
        <Field label="名称">
          <Input
            name="name"
            defaultValue={resource.name}
            required
            maxLength={100}
            disabled={busy}
          />
        </Field>
        <Field label="卡片介绍">
          <Textarea
            name="summary"
            defaultValue={resource.summary}
            maxLength={2000}
            disabled={busy}
          />
        </Field>
        {resource.kind === "website" ? (
          <Field label="访问地址">
            <Input
              type="url"
              name="websiteUrl"
              defaultValue={resource.website_url}
              required
              maxLength={2048}
              disabled={busy}
            />
          </Field>
        ) : (
          <>
            <Field label="详细介绍与安装说明">
              <Textarea
                name="description"
                defaultValue={resource.description}
                maxLength={30000}
                disabled={busy}
              />
            </Field>
            <Field label="项目网站（可选）">
              <Input
                type="url"
                name="sourceUrl"
                defaultValue={resource.source_url}
                maxLength={2048}
                disabled={busy}
              />
            </Field>
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="排序（小的在前）">
            <Input
              name="sortOrder"
              type="number"
              min={-100000}
              max={100000}
              defaultValue={resource.sort_order}
              disabled={busy}
            />
          </Field>
          <Field label="显示状态">
            <SelectField
              name="visibility"
              defaultValue={resource.visibility}
              disabled={busy}
              options={[
                { value: "draft", label: "草稿" },
                { value: "published", label: "公开" },
                { value: "hidden", label: "隐藏" },
              ]}
            />
          </Field>
        </div>
        <Button disabled={busy} className="justify-self-start">
          保存资料
        </Button>
      </form>
      {resource.kind === "tool" ? (
        <>
          <section className="grid gap-3 rounded-md border border-border bg-card p-4">
            <h2 className="text-lg font-bold">当前推荐</h2>
            {RESOURCE_TARGETS.map((target) => {
              const channel = data.channels.find((c) => c.target === target);
              const artifact = data.artifacts.find(
                (a) => a.id === channel?.artifact_id,
              );
              const release = data.releases.find(
                (r) => r.id === artifact?.release_id,
              );
              return (
                <div
                  key={target}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {targetLabel(target)}：
                    {release?.version_label ??
                      (channel ? "已暂停" : "尚未配置")}
                  </span>
                  {channel?.artifact_id ? (
                    <Button
                      disabled={busy}
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (
                          window.confirm(
                            "暂停此平台的新下载与更新推荐？历史版本仍可下载。",
                          )
                        )
                          void action({
                            action: "recommend",
                            target,
                            artifactId: null,
                          });
                      }}
                    >
                      暂停推荐
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </section>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                values = new FormData(form);
              void action({
                action: "createRelease",
                version: values.get("version"),
                notes: values.get("notes"),
              });
            }}
            className="grid gap-3 rounded-md border border-border bg-card p-4"
          >
            <h2 className="text-lg font-bold">新建本站版本</h2>
            <p className="text-sm text-muted">
              版本名与更新说明由本站维护。发布时自动分配更新序号，与 GitHub
              无关。
            </p>
            <Field label="本站版本名">
              <Input name="version" required maxLength={100} disabled={busy} />
            </Field>
            <Field label="更新说明">
              <Textarea name="notes" maxLength={30000} disabled={busy} />
            </Field>
            <Button disabled={busy} className="justify-self-start">
              创建版本草稿
            </Button>
          </form>
          {data.releases.map((release) => (
            <details
              key={`${release.id}-${formKey}`}
              open={release.status === "draft"}
              className="rounded-md border border-border bg-card p-4"
            >
              <summary className="cursor-pointer font-bold">
                {release.version_label} ·{" "}
                {
                  { draft: "草稿", published: "已发布", withdrawn: "已撤回" }[
                    release.status
                  ]
                }
                {release.release_sequence
                  ? ` · 本站序号 ${release.release_sequence}`
                  : ""}
              </summary>
              <div className="mt-4 grid gap-4">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const values = new FormData(e.currentTarget);
                    void action({
                      action: "saveRelease",
                      releaseId: release.id,
                      version: values.get("version"),
                      notes: values.get("notes"),
                    });
                  }}
                  className="grid gap-3"
                >
                  <Field label="版本名">
                    <Input
                      name="version"
                      required
                      maxLength={100}
                      defaultValue={release.version_label}
                      disabled={busy}
                    />
                  </Field>
                  <Field label="更新说明">
                    <Textarea
                      name="notes"
                      maxLength={30000}
                      defaultValue={release.notes}
                      disabled={busy}
                    />
                  </Field>
                  <Button
                    disabled={busy}
                    size="sm"
                    variant="outline"
                    className="justify-self-start"
                  >
                    保存版本说明
                  </Button>
                </form>
                {data.artifacts
                  .filter(
                    (a) =>
                      a.release_id === release.id &&
                      a.storage_status !== "cleaned",
                  )
                  .map((a) => (
                    <div
                      key={a.id}
                      className="grid gap-3 border-t border-border pt-3"
                    >
                      <p className="break-all text-sm">
                        {targetLabel(a.target)} · {a.filename} ·{" "}
                        {fileSize(a.size_bytes)} ·{" "}
                        {statusLabels[a.storage_status]}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {a.storage_status === "ready" ? (
                          <Button
                            disabled={busy}
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void run(
                                () =>
                                  requestJson(
                                    `/api/admin/resource-artifacts/${a.id}`,
                                  ),
                                "文件存储校验通过",
                              )
                            }
                          >
                            检查文件
                          </Button>
                        ) : null}
                        {release.status === "draft" ? (
                          <>
                            {!["cleanup", "ready"].includes(
                              a.storage_status,
                            ) ? (
                              <Button
                                disabled={busy}
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void run(
                                    () =>
                                      postJson(
                                        `/api/admin/resource-artifacts/${a.id}`,
                                        {
                                          action: "confirm",
                                          revision: resource.revision,
                                        },
                                      ),
                                    "已确认上传状态",
                                  )
                                }
                              >
                                确认上传结果
                              </Button>
                            ) : null}
                            <Button
                              disabled={busy}
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "删除此草稿安装包？此操作会清理已上传的文件。",
                                  )
                                )
                                  void run(
                                    () =>
                                      postJson(
                                        `/api/admin/resource-artifacts/${a.id}`,
                                        {
                                          action: "cleanup",
                                          revision: resource.revision,
                                        },
                                      ),
                                    "草稿安装包已清理",
                                  );
                              }}
                            >
                              移除并清理
                            </Button>
                          </>
                        ) : release.status === "published" ? (
                          <Button
                            disabled={
                              busy ||
                              data.channels.some((c) => c.artifact_id === a.id)
                            }
                            size="sm"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `将 ${targetLabel(a.target)} 的推荐切换为 ${release.version_label}？`,
                                )
                              )
                                void action({
                                  action: "recommend",
                                  target: a.target,
                                  artifactId: a.id,
                                });
                            }}
                          >
                            设为该平台推荐
                          </Button>
                        ) : null}
                      </div>
                      {release.status === "draft" &&
                      a.storage_status === "pending" ? (
                        <PackageUpload
                          data={data}
                          releaseId={release.id}
                          existing={a}
                          busy={busy}
                          setBusy={setBusy}
                          onData={setData}
                        />
                      ) : null}
                    </div>
                  ))}
                {release.status === "draft" ? (
                  <>
                    <PackageUpload
                      data={data}
                      releaseId={release.id}
                      busy={busy}
                      setBusy={setBusy}
                      onData={setData}
                    />
                    <PublishRelease
                      release={release}
                      busy={busy}
                      action={action}
                    />
                  </>
                ) : null}
                {release.status === "published" ? (
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const reason = new FormData(e.currentTarget).get(
                        "reason",
                      );
                      if (
                        window.confirm(
                          "撤回后停止此版本所有新下载，并暂停引用它的平台推荐。继续吗？",
                        )
                      )
                        void action({
                          action: "withdraw",
                          releaseId: release.id,
                          reason,
                        });
                    }}
                  >
                    <Input
                      aria-label="撤回原因"
                      name="reason"
                      placeholder="撤回原因"
                      required
                      maxLength={1000}
                      disabled={busy}
                      className="sm:max-w-sm"
                    />
                    <Button disabled={busy} variant="destructive" size="sm">
                      撤回版本
                    </Button>
                  </form>
                ) : null}
              </div>
            </details>
          ))}
        </>
      ) : null}
    </main>
  );
}
function PublishRelease({
  release,
  busy,
  action,
}: {
  release: ToolRelease;
  busy: boolean;
  action: (values: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <form
      className="grid gap-3 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        if (
          window.confirm(
            `发布本站版本「${release.version_label}」？发布后不可更换安装包。`,
          )
        )
          void action({
            action: "publish",
            releaseId: release.id,
            recommend: form.get("recommend") === "on",
            visible: form.get("visible") === "on",
          });
      }}
    >
      <Label className="flex items-center gap-2">
        <Checkbox name="recommend" defaultChecked disabled={busy} />
        设为所含平台的推荐版本
      </Label>
      <Label className="flex items-center gap-2">
        <Checkbox name="visible" defaultChecked disabled={busy} />
        同时公开资源
      </Label>
      <Button disabled={busy} className="justify-self-start">
        发布版本
      </Button>
    </form>
  );
}
