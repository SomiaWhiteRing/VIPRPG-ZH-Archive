import { createHmac } from "node:crypto";
import { Buffer } from "node:buffer";
import { getD1 } from "@/app/.server/db/d1";
import { getCurrentUser } from "@/app/.server/auth/current-user";
import { workReadCondition } from "@/app/.server/db/work-visibility";
import type { AppRuntime } from "@/app/.server/runtime";
import {
  productionNetplayHongKongOrigin, productionNetplayHongKongWork, productionNetplayLegacyArchive, productionNetplaySiteOrigin,
  stagingNetplayEdgeOrigin, stagingNetplayHongKongOrigin, stagingNetplaySiteOrigin,
} from "@/lib/archive/netplay-ingress";
import { getUserAvatarSrc } from "@/lib/user-profile";

type DownloadRow = {
  id: number;
  netplay_service: number | null;
  netplay_space_id: number | null;
  netplay_external_endpoint: string | null;
  work_id: number;
  manifest_sha256: string;
  packer_version: string;
  total_files: number;
  web_play_file_count: number;
  web_play_size_bytes: number;
  total_size_bytes: number;
  estimated_r2_get_count: number;
  work_original_title: string;
  work_chinese_title: string | null;
  work_cover_blob_sha256: string | null;
  engine_family: string;
};

export type ArchiveDownloadRecord = {
  id: number;
  netplayCapable: boolean;
  netplaySpaceId: number | null;
  netplayExternalEndpoint: string | null;
  manifestSha256: string;
  packerVersion: string;
  totalFiles: number;
  installTotalFiles: number;
  installTotalSizeBytes: number;
  totalSizeBytes: number;
  estimatedR2GetCount: number;
  workId: number;
  workOriginalTitle: string;
  workChineseTitle: string | null;
  workCoverBlobSha256: string | null;
  engineFamily: string;
};

export async function getArchiveNetplayEndpoint(
  runtime: AppRuntime,
  record: ArchiveDownloadRecord,
  supportsExternal = true,
): Promise<string | undefined> {
  if (!record.netplayCapable || record.netplaySpaceId === null) return;
  const options = new URL(runtime.request.url).searchParams;
  const production = runtime.origin === productionNetplaySiteOrigin && record.workId === productionNetplayHongKongWork;
  const external = record.netplayExternalEndpoint ? new URL(record.netplayExternalEndpoint) : null;
  const legacy = production && (record.id === productionNetplayLegacyArchive ||
    (!supportsExternal && external?.origin === productionNetplayHongKongOrigin));
  if (legacy) {
    return runtime.env.NETPLAY_ROOM ? new URL(`/api/netplay/v1/${record.id}/`, runtime.origin).href : undefined;
  }
  if (external) {
    const staging = runtime.origin === stagingNetplaySiteOrigin && external.origin === stagingNetplayHongKongOrigin;
    if (!supportsExternal && !staging) return;
    const hongKong = staging || (runtime.origin === productionNetplaySiteOrigin && external.origin === productionNetplayHongKongOrigin);
    const relay = hongKong && /^\/api\/netplay\/v1\/([1-9]\d*)\/(?:(?:auto|direct|turn|turn443)\/)?$/.exec(external.pathname);
    if (!relay) return external.href;
    if (staging) {
      const base = `/api/netplay/v1/${relay[1]}/`;
      if (options.get("netplayTurn") === "443") external.pathname = base + "turn443/";
      else if (options.get("netplayTurn") === "1") external.pathname = base + "turn/";
      else if (options.get("netplayDirect") === "1") external.pathname = base + "direct/";
      else if (options.get("netplayRelay") === "1") external.pathname = base;
    }
    const user = await getCurrentUser(runtime);
    const key = runtime.env.NETPLAY_HK_IDENTITY_KEY;
    if (!key) return external.href;
    const expires = Date.now() + 24 * 60 * 60 * 1000;
    const profile = [expires, Number(relay[1]), user?.displayName ?? "", getUserAvatarSrc(user?.avatarBlobSha256),
      user?.id ?? null, record.workId, record.id, record.netplaySpaceId];
    const payload = Buffer.from(JSON.stringify(profile)).toString("base64url");
    const signature = createHmac("sha256", key).update(payload).digest("base64url");
    return new URL(`identity/${payload}.${signature}/`, external).href;
  }
  if (!runtime.env.NETPLAY_ROOM) return;
  const useStagingEdge = runtime.origin === stagingNetplaySiteOrigin &&
    options.get("netplayEdge") === "1";
  const endpoint = new URL(`/api/netplay/v1/spaces/${record.netplaySpaceId}/`, useStagingEdge ? stagingNetplayEdgeOrigin : runtime.origin);
  endpoint.searchParams.set("archive", String(record.id));
  return endpoint.href;
}

export function parseArchiveVersionId(value: string): number {
  return parsePositiveId(value, "archive version id");
}
export async function getPublishedArchiveDownloadRecord(
  runtime: AppRuntime,
  id: number,
  includeLegacyNetplay = false,
): Promise<ArchiveDownloadRecord | null> {
  const access = workReadCondition(await getCurrentUser(runtime));
  const legacyWork = includeLegacyNetplay && runtime.origin === productionNetplaySiteOrigin &&
    id === productionNetplayLegacyArchive ? productionNetplayHongKongWork : null;
  const row = await getD1(runtime)
    .prepare(
      `SELECT av.id,
          av.netplay_service,
          w.netplay_space_id,
          s.external_endpoint AS netplay_external_endpoint,
          av.work_id,
          av.manifest_sha256,
          av.packer_version,
          av.total_files,
          av.web_play_file_count,
          av.web_play_size_bytes,
          av.total_size_bytes,
          av.estimated_r2_get_count,
          w.original_title AS work_original_title,
          w.chinese_title AS work_chinese_title,
          (SELECT ma.blob_sha256 FROM work_media_assets wma JOIN media_assets ma ON ma.id=wma.media_asset_id
           WHERE wma.work_id=w.id AND wma.role='cover' ORDER BY wma.sort_order LIMIT 1) AS work_cover_blob_sha256,
          w.engine_family
       FROM archive_versions av
       JOIN works w ON w.id = av.work_id
       LEFT JOIN netplay_spaces s ON s.id = w.netplay_space_id
       WHERE av.id = ?
         AND av.status = 'published'
         AND (av.is_current = 1 OR (av.work_id = ? AND av.netplay_service = 1 AND av.purged_at IS NULL))
         AND ${access.sql}
       LIMIT 1`,
    )
    .bind(id, legacyWork, ...access.binds)
    .first<DownloadRow>();
  if (!row || !row.work_original_title) return null;
  return {
    id: row.id,
    netplayCapable: row.netplay_service !== null,
    netplaySpaceId: row.netplay_space_id,
    netplayExternalEndpoint: row.netplay_external_endpoint,
    manifestSha256: row.manifest_sha256,
    packerVersion: row.packer_version,
    totalFiles: row.total_files,
    installTotalFiles: row.web_play_file_count ?? 0,
    installTotalSizeBytes: row.web_play_size_bytes ?? 0,
    totalSizeBytes: row.total_size_bytes,
    estimatedR2GetCount: row.estimated_r2_get_count,
    workId: row.work_id,
    workOriginalTitle: row.work_original_title,
    workChineseTitle: row.work_chinese_title,
    workCoverBlobSha256: row.work_cover_blob_sha256 ?? null,
    engineFamily: row.engine_family,
  };
}
import { parsePositiveId } from "@/app/.server/http/request";
