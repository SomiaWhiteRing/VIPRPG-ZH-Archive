import { useConfirm } from "@/app/components/ui/confirm-provider";
import { BackLink } from "@/app/components/ui/back-link";
import { useState, type FormEvent, type ReactNode } from "react";
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
  resourceLinks,
  RESOURCE_TARGETS,
  type ResourceEditorData,
  type ToolRelease,
} from "@/lib/resources";
import { PackageUpload } from "./package-upload";
import { ResourceContentEditor } from "./content-editor";
import { ResourceLinksEditor } from "./links-editor";
import { DownloadFilenameTemplate } from "./filename-template";
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
  const confirm = useConfirm();
  const toast = useToast();
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [formKey, setFormKey] = useState(0);
  const { resource } = data,
    base = `/api/admin/resources/${resource.id}`;
  const windy = resource.slug === "windy-translator";
  const android = resource.slug === "viprpg-android";
  const automaticPackage = windy || android;
  async function run(
    operation: () => Promise<ResourceEditorData>,
    success = "已保存",
    propagateError = false,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      setData(await operation());
      toast.success(success);
    } catch (error) {
      if (propagateError) throw error;
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  const action = (values: Record<string, unknown>, propagateError = false) =>
    run(() => postJson(base, { revision: resource.revision, ...values }), "已保存", propagateError);
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
            "Content-Type": file.type || "application/octet-stream",
            "X-Resource-Revision": String(resource.revision),
          },
          body: file,
        }),
      "图标已更新",
    );
  }
  return (
    <main>
      <BackLink href="/admin/resources" label="链接管理" variant="text" />
      <PageHeader
        compact
        title={resource.name}
        actions={
          <Button
            disabled={busy}
            variant="outline"
            onClick={async () => {
              await confirm(`重新读取“${resource.name}”会放弃表单中尚未保存的修改。继续吗？`, {
                title: "重新读取资料", confirmLabel: "放弃修改并读取",
                action: () => run(async () => {
                  const next = await requestJson<ResourceEditorData>(base);
                  setFormKey((v) => v + 1);
                  return next;
                }, "已重新读取", true),
              });
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
            alt="链接图标"
            className="size-16 object-contain"
          />
        ) : null}
        <Label className="grid gap-2">
          图标（PNG／GIF／JPG，最多 512 KiB、边长最多 512px）
          <input
            type="file"
            accept="image/png,image/gif,image/jpeg,.png,.gif,.jpg,.jpeg"
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
        <h2 className="text-lg font-bold">链接资料</h2>
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
        <ResourceContentEditor initial={resource.summary_json} disabled={busy} />
        <ResourceLinksEditor initial={resourceLinks(resource)} disabled={busy} />
        {resource.kind === "tool" ? (
          <>
            <Field label="Windows 下载按钮文案">
              <Input name="windowsButtonLabel" defaultValue={resource.windows_button_label} required disabled={busy} />
            </Field>
            <Field label="Android 下载按钮文案">
              <Input name="androidButtonLabel" defaultValue={resource.android_button_label} required disabled={busy} />
            </Field>
            <DownloadFilenameTemplate data={data} disabled={busy} />
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
        ) : null}
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
            {RESOURCE_TARGETS.filter((target) => !automaticPackage || target === (android ? "android-universal" : "windows-x64")).map((target) => {
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
                      onClick={async () => {
                        await confirm(`暂停 ${targetLabel(target)} 的新下载与更新推荐？历史版本仍可下载。`, {
                          title: "暂停推荐", confirmLabel: "暂停推荐",
                          action: () => action({ action: "recommend", target, artifactId: null }, true),
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
          {automaticPackage ? <PackageUpload data={data} busy={busy} setBusy={setBusy} onData={setData} /> : <form
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
          </form>}
          {data.releases.map((release) => (
            <details
              id={`release-${release.id}`}
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
                {!automaticPackage && release.release_sequence
                  ? ` · 本站序号 ${release.release_sequence}`
                  : ""}
              </summary>
              <div className="mt-4 grid gap-4">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const values = new FormData(e.currentTarget);
                    if (automaticPackage && release.status === "draft") {
                      await confirm(`发布更新「${values.get("version")}」？启用启动检查的用户将在下次启动 ${android ? "Android 应用" : "WindyTranslator"} 时收到更新提示。`, {
                        title: "发布更新", confirmLabel: "发布更新",
                        action: () => action({ action: "publish", releaseId: release.id, version: values.get("version"), notes: values.get("notes"), recommend: true, visible: true }, true),
                      });
                      return;
                    }
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
                    disabled={busy || (automaticPackage && release.status === "draft" && !data.artifacts.some((a) => a.release_id === release.id && a.storage_status === "ready"))}
                    size="sm"
                    variant="outline"
                    className="justify-self-start"
                  >
                    {automaticPackage && release.status === "draft" ? "发布更新" : "保存版本说明"}
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
                              onClick={async () => {
                                await confirm(`删除草稿安装包“${a.filename}”？此操作会清理已上传的文件。`, {
                                  title: "移除并清理安装包", confirmLabel: "移除并清理", destructive: true,
                                  action: () => run(() => postJson(`/api/admin/resource-artifacts/${a.id}`, {
                                    action: "cleanup", revision: resource.revision,
                                  }), "草稿安装包已清理", true),
                                });
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
                            onClick={async () => {
                              await confirm(`将 ${targetLabel(a.target)} 的推荐切换为 ${release.version_label}？`, {
                                title: "切换推荐版本", confirmLabel: "切换推荐",
                                action: () => action({ action: "recommend", target: a.target, artifactId: a.id }, true),
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
                    <div hidden={automaticPackage && data.artifacts.some((a) => a.release_id === release.id && a.storage_status !== "cleaned")}><PackageUpload
                      data={data}
                      releaseId={release.id}
                      busy={busy}
                      setBusy={setBusy}
                      onData={setData}
                    /></div>
                    {!automaticPackage ? <PublishRelease
                      ready={data.artifacts.some((a) => a.release_id === release.id && a.storage_status === "ready")}
                      release={release}
                      busy={busy}
                      action={action}
                    /> : null}
                  </>
                ) : null}
                {release.status === "published" ? (
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const reason = new FormData(e.currentTarget).get(
                        "reason",
                      );
                      await confirm(`撤回“${release.version_label}”后停止此版本所有新下载，并暂停引用它的平台推荐。继续吗？`, {
                        title: "撤回版本", confirmLabel: "撤回版本", destructive: true,
                        action: () => action({ action: "withdraw", releaseId: release.id, reason }, true),
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
  ready = true,
  release,
  busy,
  action,
}: {
  ready?: boolean;
  release: ToolRelease;
  busy: boolean;
  action: (values: Record<string, unknown>, propagateError?: boolean) => Promise<void>;
}) {
  const confirm = useConfirm();
  return (
    <form
      className="grid gap-3 border-t border-border pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        await confirm(`发布本站版本「${release.version_label}」？发布后不可更换安装包。`, {
          title: "发布版本", confirmLabel: "发布版本",
          action: () => action({
            action: "publish", releaseId: release.id,
            recommend: form.get("recommend") === "on", visible: form.get("visible") === "on",
          }, true),
        });
      }}
    >
      <Label className="flex items-center gap-2">
        <Checkbox name="recommend" defaultChecked disabled={busy} />
        设为所含平台的推荐版本
      </Label>
      <Label className="flex items-center gap-2">
        <Checkbox name="visible" defaultChecked disabled={busy} />
        同时公开链接
      </Label>
      <Button disabled={busy || !ready} className="justify-self-start">
        发布版本
      </Button>
    </form>
  );
}
