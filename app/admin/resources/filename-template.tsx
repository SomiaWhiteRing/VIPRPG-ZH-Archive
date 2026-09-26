import { useId, useState } from "react";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { downloadFilenameTemplateError, MAX_DOWNLOAD_FILENAME_TEMPLATE_LENGTH, resourceDownloadFilename } from "@/lib/resource-filename";
import { RESOURCE_TARGETS, targetLabel, type ResourceEditorData } from "@/lib/resources";

export function DownloadFilenameTemplate({ data, disabled }: { data: ResourceEditorData; disabled: boolean }) {
  const id = useId();
  const [value, setValue] = useState(data.resource.download_filename_template);
  const error = downloadFilenameTemplateError(value);
  const samples = RESOURCE_TARGETS.flatMap((target) => {
    const channel = data.channels.find((c) => c.target === target);
    const artifact = data.artifacts.find((a) => a.id === channel?.artifact_id)
      ?? data.artifacts.find((a) => a.target === target && a.storage_status !== "cleaned");
    const release = data.releases.find((r) => r.id === artifact?.release_id);
    return artifact && release ? [{ artifact, version: release.version_label }] : [];
  });
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>下载文件名模板（不含扩展名，可选）</Label>
      <Input
        id={id}
        name="downloadFilenameTemplate"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={"软件名_${version}"}
        maxLength={MAX_DOWNLOAD_FILENAME_TEMPLATE_LENGTH}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={`${id}-help ${id}-preview`}
      />
      <p id={`${id}-help`} className="text-sm text-muted">
        留空沿用上传文件名；<code>{"${version}"}</code> 代表该安装包的本站版本名，扩展名自动添加。保存后适用于所有版本。
      </p>
      <div id={`${id}-preview`} className="grid gap-1 break-all text-sm text-muted" aria-live="polite">
        {error ? <p role="alert">{error}</p> : samples.length ? samples.map(({ artifact, version }) => (
          <p key={artifact.id}>{targetLabel(artifact.target)} · {version}：{resourceDownloadFilename(value, artifact, version)}</p>
        )) : value.trim() ? (
          <p>示例（版本 1.2.3）：{resourceDownloadFilename(value, { filename: "", format: data.resource.slug === "viprpg-android" ? "apk" : "zip" }, "1.2.3")}</p>
        ) : <p>上传安装包后可预览下载文件名。</p>}
      </div>
    </div>
  );
}
