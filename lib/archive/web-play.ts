import { downloadZipBuilderVersion } from "@/lib/archive/download";

export const webPlayInstallerVersion = "opfs-v7-skip-non-web-runtime-local-write";
export const easyRpgRuntimeVersion = "0.8.1.1";
export const easyRpgRuntimeBasePath = `/play/runtime/easyrpg/${easyRpgRuntimeVersion}`;

export function buildArchiveDownloadUrl(archiveVersionId: number): string {
  return `/api/archive-versions/${archiveVersionId}/download?zip_builder=${encodeURIComponent(
    downloadZipBuilderVersion,
  )}`;
}

export function buildWebPlayKey(input: {
  archiveVersionId: number;
  manifestSha256: string;
}): string {
  return [
    "av",
    String(input.archiveVersionId),
    input.manifestSha256.slice(0, 16),
    normalizeKeyPart(downloadZipBuilderVersion),
    normalizeKeyPart(webPlayInstallerVersion),
    normalizeKeyPart(easyRpgRuntimeVersion),
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
