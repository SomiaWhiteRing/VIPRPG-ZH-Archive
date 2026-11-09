import { downloadZipBuilderVersion } from "@/lib/archive/download";
import { webPlayDownloadProfile, downloadWithoutPlayerProfile } from "@/lib/archive/web-play-download-policy";
import easyRpgRuntime from "@/lib/archive/easyrpg-runtime.json";
import easyRpgDelivery from "@/lib/archive/easyrpg-delivery.json";

export const webPlayInstallerVersion = "opfs-v12-workerfs";
export const easyRpgRuntimeVersion = easyRpgRuntime.version;
export const easyRpgRuntimeBasePath = `/play/runtime/easyrpg/${easyRpgRuntimeVersion}`;

export function easyRpgRuntimeAssetBasePath(origin: string): string {
  const assetOrigin = (easyRpgDelivery as Record<string, string>)[origin] ?? "";
  return `${assetOrigin}${easyRpgRuntimeBasePath}`;
}

export function buildArchiveDownloadUrl(archiveVersionId: number): string {
  return `/api/archive-versions/${archiveVersionId}/download?zip_builder=${encodeURIComponent(
    downloadZipBuilderVersion,
  )}`;
}

export function buildWebPlayDownloadUrl(archiveVersionId: number): string {
  return `${buildArchiveDownloadUrl(archiveVersionId)}&profile=${encodeURIComponent(webPlayDownloadProfile)}`;
}

export function buildDownloadWithoutPlayerUrl(archiveVersionId: number): string {
  return `${buildArchiveDownloadUrl(archiveVersionId)}&profile=${encodeURIComponent(downloadWithoutPlayerProfile)}`;
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
