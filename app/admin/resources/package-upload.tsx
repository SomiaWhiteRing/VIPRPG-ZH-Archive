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
import { postJson } from "./client";

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
      setError("文件需大于 0 且不超过 95 MB");
      return;
    }
    const form = new FormData(event.currentTarget);
    const format = file.name.toLowerCase().split(".").pop();
    const target = existing?.target ?? (automaticPackage ? (android ? "android-universal" : "windows-x64") : form.get("target"));
    if (
      !((target === "windows-x64" && (format === "zip" || format === "exe")) ||
        (target === "android-universal" && format === "apk"))
    ) {
      setError("Windows 请选择 ZIP 或 EXE 文件，Android 请选择 APK 文件");
      return;
    }
    if (data.resource.slug === "windy-translator" && (target !== "windows-x64" || format !== "zip")) {
      setError("Windy 更新仅支持 Windows x64 ZIP");
      return;
    }
    setBusy(true);
    setError("");
    setProgress("正在计算 SHA-256…");
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
          reject(new Error("已取消"));
        };
        worker.onmessage = (
          e: MessageEvent<{ sha256?: string; error?: string }>,
        ) => {
          stop();
          if (e.data.sha256) resolve(e.data.sha256);
          else reject(new Error(e.data.error));
        };
        worker.onerror = () => {
          stop();
          reject(new Error("文件校验计算失败"));
        };
        worker.postMessage(file);
      });
      if (
        existing &&
        (existing.sha256 !== sha256 || existing.size_bytes !== file.size)
      )
        throw new Error("所选文件与原登记内容不同，请清理旧记录后重新添加");
      const registered = existing
        ? { ...data, artifactId: existing.id }
        : await postJson<ResourceEditorData & { artifactId: string }>(
            `/api/admin/resources/${data.resource.id}/artifacts`,
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
        element?.scrollIntoView({ block: "center" });
      });
      if (artifact?.storage_status === "ready" || savedRelease?.status !== "draft") {
        setProgress("此安装包已上传，已定位原版本");
        return;
      }
      if (artifact && artifact.storage_status !== "pending") throw new Error("此安装包已登记，请在原版本中确认上传结果");
      setProgress("正在上传…");
      const result = await new Promise<ResourceEditorData>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(
            "PUT",
            `/api/admin/resource-artifacts/${registered.artifactId}`,
          );
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          xhr.setRequestHeader(
            "X-Resource-Revision",
            String(registered.resource.revision),
          );
          xhr.upload.onprogress = (e) =>
            setProgress(
              e.lengthComputable
                ? `已发送 ${Math.round((e.loaded / e.total) * 100)}%，完成后等待校验`
                : "正在上传…",
            );
          xhr.onload = () => {
            cancel.current = null;
            try {
              const value = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) resolve(value);
              else reject(new Error(value.detail || value.error || "上传失败"));
            } catch (error) {
              reject(error);
            }
          };
          xhr.onerror = () => {
            cancel.current = null;
            reject(new Error("网络中断，请重新读取后确认上传结果"));
          };
          xhr.onabort = () => {
            cancel.current = null;
            reject(
              new Error("已取消发送，请重新读取并确认服务器是否已收到文件"),
            );
          };
          cancel.current = () => xhr.abort();
          xhr.send(file);
        },
      );
      onData(result);
      setProgress("上传与校验完成");
      toast.success("安装包已校验，可以发布。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
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
        {existing ? "重新上传同一文件" : "添加安装包"}
      </h3>
      {!existing && !automaticPackage ? (
        <>
          <Label className="grid gap-2">
            平台
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
            <summary className="cursor-pointer text-sm">可选：软件更新识别</summary>
            <p className="mt-2 text-sm text-muted">
              普通下载无需填写。供客户端识别已安装版本；留空仍可上传和下载，但无法自动判断是否有新版。
            </p>
            <Label className="mt-2 grid gap-2">
              构建标识
              <Input name="applicationBuildId" maxLength={200} disabled={busy} />
            </Label>
          </details>
        </>
      ) : null}
      <Label className="grid gap-2">
        {android ? "GitHub 发布 APK（最多 95 MB）" : windy ? "GitHub 发行 ZIP（最多 95 MB）" : "安装包（ZIP、EXE 或 APK，最多 95 MB）"}
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
                if (token === selection.current) setError(error instanceof Error ? error.message : String(error));
              }
            }
          }}
        />
      </Label>
      {automaticPackage && build && !releaseId ? <>
        <Label className="grid gap-2">版本名<Input name="version" value={version} onChange={(e) => setVersion(e.target.value)} required maxLength={100} disabled={busy} /></Label>
        <Label className="grid gap-2">更新说明<Textarea name="notes" maxLength={30000} disabled={busy} /></Label>
      </> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy || !file || (automaticPackage && !build)} size="sm">
          上传并校验
        </Button>
        {cancel.current ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => cancel.current?.()}
          >
            取消
          </Button>
        ) : null}
        <span role="status" className="text-sm text-muted">
          {progress}
        </span>
      </div>
    </form>
  );
}
