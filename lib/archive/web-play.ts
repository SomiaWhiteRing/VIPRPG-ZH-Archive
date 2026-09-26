import { downloadZipBuilderVersion } from "@/lib/archive/download";
import { webPlayDownloadProfile } from "@/lib/archive/web-play-local-policy";
import easyRpgRuntime from "@/lib/archive/easyrpg-runtime.json";

export const webPlayInstallerVersion = "opfs-v12-workerfs";
export const easyRpgRuntimeVersion = easyRpgRuntime.version;
export const easyRpgRuntimeBasePath = `/play/runtime/easyrpg/${easyRpgRuntimeVersion}`;

export function buildArchiveDownloadUrl(archiveVersionId: number): string {
  return `/api/archive-versions/${archiveVersionId}/download?zip_builder=${encodeURIComponent(
    downloadZipBuilderVersion,
  )}`;
}

export function buildWebPlayDownloadUrl(archiveVersionId: number): string {
  return `${buildArchiveDownloadUrl(archiveVersionId)}&profile=${encodeURIComponent(webPlayDownloadProfile)}`;
}

export function buildWebPlayKey(input: {
  archiveVersionId: number;
  manifestSha256: string;
}): string {
  // Installed bytes depend on the archive and local format, not the player or ZIP transport.
  return [
    "av",
    String(input.archiveVersionId),
    input.manifestSha256.slice(0, 16),
    normalizeKeyPart(webPlayInstallerVersion),
  ].join("-");
}

function normalizeKeyPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}
