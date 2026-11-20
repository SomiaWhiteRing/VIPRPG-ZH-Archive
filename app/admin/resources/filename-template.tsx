import { RichMessage } from "@/app/components/ui/rich-message";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { useId, useState } from "react";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { downloadFilenameTemplateError, MAX_DOWNLOAD_FILENAME_TEMPLATE_LENGTH, resourceDownloadFilename } from "@/lib/resource-filename";
import { RESOURCE_TARGETS, targetLabel, type ResourceEditorData } from "@/lib/resources";

export function DownloadFilenameTemplate({ data, disabled }: { data: ResourceEditorData; disabled: boolean }) {
  const t = useMessages();
  const locale = useUiLocale();
  const id = useId();
  const [value, setValue] = useState(data.resource.download_filename_template);
  const error = downloadFilenameTemplateError(value, locale);
  const samples = RESOURCE_TARGETS.flatMap((target) => {
    const channel = data.channels.find((c) => c.target === target);
    const artifact = data.artifacts.find((a) => a.id === channel?.artifact_id)
      ?? data.artifacts.find((a) => a.target === target && a.storage_status !== "cleaned");
    const release = data.releases.find((r) => r.id === artifact?.release_id);
    return artifact && release ? [{ artifact, version: release.version_label }] : [];
  });
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t("admin.resources.filename")}</Label>
      <Input
        id={id}
        name="downloadFilenameTemplate"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t("admin.resources.filenamePlaceholder", { version: "${version}" })}
        maxLength={MAX_DOWNLOAD_FILENAME_TEMPLATE_LENGTH}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={`${id}-help ${id}-preview`}
      />
      <p id={`${id}-help`} className="text-sm text-muted">
        <RichMessage id="admin.resources.filenameHelp" values={{ variable: "${version}" }} components={{ code: children => <code key="variable">{children}</code> }} />
      </p>
      <div id={`${id}-preview`} className="grid gap-1 break-all text-sm text-muted" aria-live="polite">
        {error ? <p role="alert">{error}</p> : samples.length ? samples.map(({ artifact, version }) => (
          <p key={artifact.id}>{targetLabel(artifact.target)} ({version})：{resourceDownloadFilename(value, artifact, version)}</p>
        )) : value.trim() ? (
          <p>{t("admin.resources.filenameExample", { name: resourceDownloadFilename(value, { filename: "", format: data.resource.slug === "viprpg-android" ? "apk" : "zip" }, "1.2.3") })}</p>
        ) : <p>{t("admin.resources.filenameEmpty")}</p>}
      </div>
    </div>
  );
}
