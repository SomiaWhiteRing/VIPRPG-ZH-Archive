import { useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "@/app/root";
import { buildArchiveDownloadUrl, buildWebPlayDownloadUrl } from "@/lib/archive/web-play";

// Every public download link and size label shares the root session preference.
// Reusing already-loaded totals avoids per-card requests or database reads.
export function useArchiveDownload() {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const includePlayer = root?.session?.preferences.includePlayerInZip ?? true;
  return {
    includePlayer,
    downloadUrl: includePlayer ? buildArchiveDownloadUrl : buildWebPlayDownloadUrl,
    downloadSize: (archive: { downloadSizeBytes: number | null; totalSizeBytes: number; embeddedPlayerSizeBytes: number }) =>
      includePlayer ? archive.downloadSizeBytes : archive.totalSizeBytes - archive.embeddedPlayerSizeBytes,
  };
}
