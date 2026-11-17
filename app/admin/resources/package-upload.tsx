import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { formatFeedbackError } from "@/lib/i18n/feedback";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/app/components/ui/button";
import { Notice } from "@/app/components/ui/notice";
import { useToast } from "@/app/components/ui/toast";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { readAndroidFile, type AndroidBuildInfo } from "@/lib/android-package";
import { readWindyFile, type WindyBuildInfo } from "@/lib/windy-package";
import { MAX_TOOL_BYTES } from "@/lib/resource-limits";
import type { ResourceEditorData, ToolArtifact } from "@/lib/resources";
import { postJson } from "@/lib/ui/api-response";
import { scrollElementIntoView } from "@/lib/ui/scroll.js";

export function PackageUpload({
  data,
  releaseId,
  existing,
  busy,
  setBusy,
  onData,
}: {
  data: ResourceEditorData;
  releaseId?: string;
  existing?: ToolArtifact;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onData: (data: ResourceEditorData) => void;
}) {
  const t = useMessages();
  const locale = useUiLocale();
  const toast = useToast();
  const windy = data.resource.slug === "windy-translator";
  const android = data.resource.slug === "viprpg-android";
  const automaticPackage = windy || android;
  const readPackage = android ? readAndroidFile : readWindyFile;
  const [build, setBuild] = useState<WindyBuildInfo | AndroidBuildInfo | null>(null);
  const [version, setVersion] = useState("");
  const selection = useRef(0);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(""),
    [file, setFile] = useState<File | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    if (file.size < 1 || file.size > MAX_TOOL_BYTES) {
      setError(t("admin.package.size"));
      return;
    }
    const form = new FormData(event.currentTarget);
    const format = file.name.toLowerCase().split(".").pop();
    const target = existing?.target ?? (automaticPackage ? (android ? "android-universal" : "windows-x64") : form.get("target"));
    if (
      !((target === "windows-x64" && (format === "zip" || format === "exe")) ||
        (target === "android-universal" && format === "apk"))
    ) {
      setError(t("admin.package.format"));
      return;
    }
    if (data.resource.slug === "windy-translator" && (target !== "windows-x64" || format !== "zip")) {
      setError(t("admin.package.windyFormat"));
      return;
    }
    setBusy(true);
    setError("");
    setProgress(t("admin.package.calculating"));
    try {
      const metadata = automaticPackage ? await readPackage(file) : null;
      const sha256 = await new Promise<string>((resolve, reject) => {
        const worker = new Worker(
          new URL("./hash-worker.ts", import.meta.url),
          { type: "module" },
        );
        const stop = () => {
          worker.terminate();
          cancel.current = null;
        };
        cancel.current = () => {
          stop();
          reject(new Error(t("admin.package.canceled")));
        };
        worker.onmessage = (
          e: MessageEvent<{ sha256: string } | { error: true }>,
        ) => {
          stop();
          if ("sha256" in e.data) resolve(e.data.sha256);
          else reject(new Error(t("admin.package.checksum")));
        };
        worker.onerror = () => {
          stop();
          reject(new Error(t("admin.package.checksum")));
        };
        worker.postMessage(file);
      });
      if (
        existing &&
        (existing.sha256 !== sha256 || existing.size_bytes !== file.size)
      )
        throw new Error(t("admin.package.different"));
      const registered = existing
        ? { ...data, artifactId: existing.id }
        : await postJson<ResourceEditorData & { artifactId: string }>(
            `/api/admin/resources/${data.resource.id}/artifacts?${UI_LOCALE_PARAM}=${locale}`,
            {
              revision: data.resource.revision,
              releaseId,
              target,
              version: form.get("version") || metadata?.version,
              notes: form.get("notes") || "",
              filename: file.name,
              sizeBytes: file.size,
              sha256,
              applicationBuildId: metadata?.applicationBuildId ?? (form.get("applicationBuildId") || ""),
            },
          );
      onData(registered);
      const artifact = registered.artifacts.find((a) => a.id === registered.artifactId);
      const savedRelease = registered.releases.find((r) => r.id === artifact?.release_id);
      if (artifact) requestAnimationFrame(() => {
        const element = document.getElementById(`release-${artifact.release_id}`);
        element?.setAttribute("open", "");
        if (element) scrollElementIntoView(element, { block: "nearest", inline: "nearest" });
      });
      if (artifact?.storage_status === "ready" || savedRelease?.status !== "draft") {
        setProgress(t("admin.package.already"));
        return;
      }
      if (artifact && artifact.storage_status !== "pending") throw new Error(t("admin.package.registered"));
      setProgress(t("admin.package.sending"));
      const result = await new Promise<ResourceEditorData>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(
            "PUT",
            `/api/admin/resource-artifacts/${registered.artifactId}?${UI_LOCALE_PARAM}=${locale}`,
          );
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          xhr.setRequestHeader(
            "X-Resource-Revision",
            String(registered.resource.revision),
          );
          xhr.upload.onprogress = (e) =>
            setProgress(
              e.lengthComputable
                ? t("admin.package.sent", { percent: Math.round((e.loaded / e.total) * 100) })
                : t("admin.package.sending"),
            );
          xhr.onload = () => {
            cancel.current = null;
            try {
              const value = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) resolve(value);
              else reject(new Error(value.detail || value.error || t("admin.package.failed")));
            } catch (error) {
              reject(error);
            }
          };
          xhr.onerror = () => {
            cancel.current = null;
            reject(new Error(t("admin.package.network")));
          };
          xhr.onabort = () => {
            cancel.current = null;
            reject(
              new Error(t("admin.package.abort")),
            );
          };
          cancel.current = () => xhr.abort();
          xhr.send(file);
        },
      );
      onData(result);
      setProgress(t("admin.package.done"));
      toast.success(t("admin.package.ready"));
    } catch (error) {
      toast.error(formatFeedbackError(error, locale, t("admin.package.failed")));
      setProgress("");
    } finally {
      cancel.current = null;
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={upload}
      className="grid gap-3 rounded-md border border-dashed border-border p-3"
    >
      {error ? <Notice>{error}</Notice> : null}
      <h3 className="font-semibold">
        {existing ? t("admin.package.reupload") : t("admin.package.add")}
      </h3>
      {!existing && !automaticPackage ? (
        <>
          <Label className="grid gap-2">
            {t("admin.package.platform")}
            <SelectField
              name="target"
              defaultValue="windows-x64"
              disabled={busy}
              options={[
                { value: "windows-x64", label: "Windows x64" },
                { value: "android-universal", label: "Android" },
              ]}
            />
          </Label>
          <details className="rounded border border-border p-2">
            <summary className="cursor-pointer text-sm">{t("admin.package.detect")}</summary>
            <p className="mt-2 text-sm text-muted">
              {t("admin.package.detectHelp")}
            </p>
            <Label className="mt-2 grid gap-2">
              {t("admin.package.build")}
              <Input name="applicationBuildId" maxLength={200} disabled={busy} />
            </Label>
          </details>
        </>
      ) : null}
      <Label className="grid gap-2">
        {android ? t("admin.package.android") : windy ? t("admin.package.windy") : t("admin.package.package")}
        <input
          type="file"
          accept={android ? ".apk" : windy ? ".zip" : ".zip,.exe,.apk"}
          required
          disabled={busy}
          onChange={async (e) => {
            const selected = e.target.files?.[0] ?? null;
            const token = ++selection.current;
            setFile(selected);
            setBuild(null);
            setError("");
            setProgress("");
            if (automaticPackage && selected) {
              try {
                const info = await readPackage(selected);
                if (token !== selection.current) return;
                setBuild(info);
                setVersion(info.version);
              } catch (error) {
                if (token === selection.current) setError(formatFeedbackError(error, locale, t("admin.package.error.verification")));
              }
            }
          }}
        />
      </Label>
      {automaticPackage && build && !releaseId ? <>
        <Label className="grid gap-2">{t("admin.resourceRelease.version")}<Input name="version" value={version} onChange={(e) => setVersion(e.target.value)} required maxLength={100} disabled={busy} /></Label>
        <Label className="grid gap-2">{t("admin.resourceRelease.notes")}<Textarea name="notes" maxLength={30000} disabled={busy} /></Label>
      </> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy || !file || (automaticPackage && !build)} size="sm">
          {t("admin.package.submit")}
        </Button>
        {cancel.current ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => cancel.current?.()}
          >
            {t("play.save.cancel")}
          </Button>
        ) : null}
        <span role="status" className="text-sm text-muted">
          {progress}
        </span>
      </div>
    </form>
  );
}
