import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
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
import { StickySaveBar } from "@/app/admin/admin-list-controls";
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
import { postJson, requestJsonValue as requestJson } from "@/lib/ui/api-response";
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-2">
      {label}
      {children}
    </Label>
  );
}
export function ResourceEditor({ initial }: { initial: ResourceEditorData }) {
  const t = useMessages();
  const locale = useUiLocale();
  const confirm = useConfirm();
  const toast = useToast();
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [formKey, setFormKey] = useState(0);
  const { resource } = data,
    base = `/api/admin/resources/${resource.id}`;
  const languageQuery = `?${UI_LOCALE_PARAM}=${locale}`;
  const windy = resource.slug === "windy-translator";
  const android = resource.slug === "viprpg-android";
  const automaticPackage = windy || android;
  async function run(
    operation: () => Promise<ResourceEditorData>,
    success = t("admin.resources.saved"),
    propagateError = false,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      setData(await operation());
      toast.success(success);
    } catch (error) {
      if (propagateError) throw error;
      toast.error(error instanceof Error ? error : String(error));
    } finally {
      setBusy(false);
    }
  }
  const action = (values: Record<string, unknown>, propagateError = false) =>
    run(() => postJson(base + languageQuery, { revision: resource.revision, ...values }), t("admin.resources.saved"), propagateError);
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
        requestJson(base + "/icon" + languageQuery, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-Resource-Revision": String(resource.revision),
          },
          body: file,
        }),
      t("admin.resources.iconUpdated"),
    );
  }
  return (
    <main>
      <BackLink href="/admin/resources" label={t("admin.resources.title")} variant="text" />
      <PageHeader
        compact
        title={resource.name}
        actions={
          <Button
            disabled={busy}
            variant="outline"
            onClick={async () => {
              await confirm(t("admin.resources.reloadPrompt", { name: resource.name }), {
                title: t("admin.resources.reloadTitle"), confirmLabel: t("admin.resources.reloadConfirm"),
                action: () => run(async () => {
                  const next = await requestJson<ResourceEditorData>(base + languageQuery);
                  setFormKey((v) => v + 1);
                  return next;
                }, t("admin.resources.reloaded"), true),
              });
            }}
          >
            {t("admin.resources.reload")}
          </Button>
        }
      />
      <section className="admin-panel flex flex-wrap items-center gap-4">
        {resource.icon_blob_sha256 ? (
          <img
            src={`${base}/icon?v=${resource.revision}`}
            alt={t("admin.resources.icon")}
            className="size-16 object-contain"
          />
        ) : null}
        <Label className="grid gap-2">
          {t("admin.resources.iconHelp")}
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
        className="admin-panel grid gap-4"
      >
        <h2 className="admin-section-title">{t("admin.resources.details")}</h2>
        <p className="flex flex-wrap gap-x-2 text-sm text-muted">
          <span>{t("admin.resources.slugValue", { slug: resource.slug })}</span>
          <span>{resource.kind === "tool" ? t("admin.resources.tool") : t("admin.resources.external")}</span>
        </p>
        <Field label={t("creator.name")}>
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
            <Field label={t("admin.resources.windowsLabel")}>
              <Input name="windowsButtonLabel" defaultValue={resource.windows_button_label} required disabled={busy} />
            </Field>
            <Field label={t("admin.resources.androidLabel")}>
              <Input name="androidButtonLabel" defaultValue={resource.android_button_label} required disabled={busy} />
            </Field>
            <DownloadFilenameTemplate data={data} disabled={busy} />
            <Field label={t("admin.resources.projectOptional")}>
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
          <Field label={t("admin.resources.sort")}>
            <Input
              name="sortOrder"
              type="number"
              min={-100000}
              max={100000}
              defaultValue={resource.sort_order}
              disabled={busy}
            />
          </Field>
          <Field label={t("admin.resources.visibility")}>
            <SelectField
              name="visibility"
              defaultValue={resource.visibility}
              disabled={busy}
              options={[
                { value: "draft", label: t("admin.resources.draft") },
                { value: "published", label: t("admin.discussions.public") },
                { value: "hidden", label: t("admin.discussionTags.hidden") },
              ]}
            />
          </Field>
        </div>
        <StickySaveBar><Button disabled={busy}>
          {t("admin.resources.saveDetails")}
        </Button></StickySaveBar>
      </form>
      {resource.kind === "tool" ? (
        <>
          <section className="admin-panel grid gap-3">
            <h2 className="admin-section-title">{t("admin.resourceRelease.current")}</h2>
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
                      (channel ? t("admin.resourceRelease.paused") : t("admin.resourceRelease.unset"))}
                  </span>
                  {channel?.artifact_id ? (
                    <Button
                      disabled={busy}
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await confirm(t("admin.resourceRelease.pausePrompt", { target: targetLabel(target) }), {
                          title: t("admin.resourceRelease.pause"), confirmLabel: t("admin.resourceRelease.pause"),
                          action: () => action({ action: "recommend", target, artifactId: null }, true),
                        });
                      }}
                    >
                      {t("admin.resourceRelease.pause")}
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
            className="admin-panel grid gap-3"
          >
            <h2 className="admin-section-title">{t("admin.resourceRelease.new")}</h2>
            <p className="text-sm text-muted">
              {t("admin.resourceRelease.sequenceHelp")}
            </p>
            <Field label={t("admin.resourceRelease.siteVersion")}>
              <Input name="version" required maxLength={100} disabled={busy} />
            </Field>
            <Field label={t("admin.resourceRelease.notes")}>
              <Textarea name="notes" maxLength={30000} disabled={busy} />
            </Field>
            <Button disabled={busy} className="justify-self-start">
              {t("admin.resourceRelease.draft")}
            </Button>
          </form>}
          <p className="text-sm text-muted">
            {t("admin.resourceRelease.cleanupHelp")}
          </p>
          {data.releases.map((release) => (
            <details
              id={`release-${release.id}`}
              key={`${release.id}-${formKey}`}
              open={release.status === "draft"}
              className="admin-panel admin-details"
            >
              <summary>
                {release.version_label} ({t(release.status === "draft" ? "admin.resources.draft" : release.status === "published" ? "upload.own.status.published" : "inbox.withdrawn")})
                {!automaticPackage && release.release_sequence
                  ? <span className="ms-2">{t("admin.resourceRelease.sequence", { count: release.release_sequence })}</span>
                  : null}
              </summary>
              <div className="mt-4 grid gap-4">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const values = new FormData(e.currentTarget);
                    if (automaticPackage && release.status === "draft") {
                      await confirm(t("admin.resourceRelease.publishUpdatePrompt", { version: String(values.get("version") ?? ""), app: android ? t("admin.resourceRelease.androidApp") : "WindyTranslator" }), {
                        title: t("admin.resourceRelease.publishUpdate"), confirmLabel: t("admin.resourceRelease.publishUpdate"),
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
                  <Field label={t("admin.resourceRelease.version")}>
                    <Input
                      name="version"
                      required
                      maxLength={100}
                      defaultValue={release.version_label}
                      disabled={busy}
                    />
                  </Field>
                  <Field label={t("admin.resourceRelease.notes")}>
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
                    {automaticPackage && release.status === "draft" ? t("admin.resourceRelease.publishUpdate") : t("admin.resourceRelease.saveNotes")}
                  </Button>
                </form>
                {data.artifacts
                  .filter(
                    (a) =>
                      a.release_id === release.id &&
                      (a.storage_status !== "cleaned" || release.published_at !== null),
                  )
                  .map((a) => (
                    <div
                      key={a.id}
                      className="grid gap-3 border-t border-border pt-3"
                    >
                      <p className="flex flex-wrap gap-x-2 break-all text-sm">
                        <span>{targetLabel(a.target)}</span>
                        <span>{a.filename} ({fileSize(a.size_bytes)})</span>
                        <span>{t(`admin.resourceRelease.${a.storage_status}`)}</span>
                      </p>
                      {release.published_at !== null && ["cleanup", "cleaned"].includes(a.storage_status) ? (
                        <p className="flex flex-wrap gap-x-2 break-all text-sm text-muted">
                          <span>{t("admin.resourceRelease.oldPackage", { hash: a.sha256 })}</span>
                          {a.application_build_id ? <span>{t("admin.resourceRelease.build", { id: a.application_build_id })}</span> : null}
                        </p>
                      ) : null}
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
                                    `/api/admin/resource-artifacts/${a.id}${languageQuery}`,
                                  ),
                                t("admin.resourceRelease.verified"),
                              )
                            }
                          >
                            {t("admin.resourceRelease.check")}
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
                                        `/api/admin/resource-artifacts/${a.id}${languageQuery}`,
                                        {
                                          action: "confirm",
                                          revision: resource.revision,
                                        },
                                      ),
                                    t("admin.resourceRelease.confirmed"),
                                  )
                                }
                              >
                                {t("admin.resourceRelease.confirmUpload")}
                              </Button>
                            ) : null}
                            <Button
                              disabled={busy}
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                await confirm(t("admin.resourceRelease.removePrompt", { name: a.filename }), {
                                  title: t("admin.resourceRelease.removeTitle"), confirmLabel: t("admin.resourceRelease.remove"), destructive: true,
                                  action: () => run(() => postJson(`/api/admin/resource-artifacts/${a.id}${languageQuery}`, {
                                    action: "cleanup", revision: resource.revision,
                                  }), t("admin.resourceRelease.removed"), true),
                                });
                              }}
                            >
                              {t("admin.resourceRelease.remove")}
                            </Button>
                          </>
                        ) : release.status === "published" && a.storage_status === "ready" ? (
                          <Button
                            disabled={
                              busy ||
                              data.channels.some((c) => c.artifact_id === a.id)
                            }
                            size="sm"
                            onClick={async () => {
                              await confirm(t("admin.resourceRelease.switchPrompt", { target: targetLabel(a.target), version: release.version_label }), {
                                title: t("admin.resourceRelease.switchTitle"), confirmLabel: t("admin.resourceRelease.switch"),
                                action: () => action({ action: "recommend", target: a.target, artifactId: a.id }, true),
                              });
                            }}
                          >
                            {t("admin.resourceRelease.set")}
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
                      await confirm(t("admin.resourceRelease.withdrawPrompt", { version: release.version_label }), {
                        title: t("admin.resourceRelease.withdraw"), confirmLabel: t("admin.resourceRelease.withdraw"), destructive: true,
                        action: () => action({ action: "withdraw", releaseId: release.id, reason }, true),
                      });
                    }}
                  >
                    <Input
                      aria-label={t("admin.resourceRelease.withdrawReason")}
                      name="reason"
                      placeholder={t("admin.resourceRelease.withdrawReason")}
                      required
                      maxLength={1000}
                      disabled={busy}
                      className="sm:max-w-sm"
                    />
                    <Button disabled={busy} variant="destructive" size="sm">
                      {t("admin.resourceRelease.withdraw")}
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
  const t = useMessages();
  const confirm = useConfirm();
  return (
    <form
      className="grid gap-3 border-t border-border pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        await confirm(t("admin.resourceRelease.publishPrompt", { version: release.version_label }), {
          title: t("admin.resourceRelease.publish"), confirmLabel: t("admin.resourceRelease.publish"),
          action: () => action({
            action: "publish", releaseId: release.id,
            recommend: form.get("recommend") === "on", visible: form.get("visible") === "on",
          }, true),
        });
      }}
    >
      <Label className="flex items-center gap-2">
        <Checkbox name="recommend" defaultChecked disabled={busy} />
        {t("admin.resourceRelease.recommend")}
      </Label>
      <Label className="flex items-center gap-2">
        <Checkbox name="visible" defaultChecked disabled={busy} />
        {t("admin.resourceRelease.public")}
      </Label>
      <Button disabled={busy || !ready} className="justify-self-start">
        {t("admin.resourceRelease.publish")}
      </Button>
    </form>
  );
}
