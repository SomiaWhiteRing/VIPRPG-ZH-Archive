import { listLocalLibraryWorks, listWebPlayInstallations } from "@/app/play/[workId]/web-play-db";
import { readSaveNames } from "@/app/play/[workId]/web-play-save-transfer";
import { listScreenshotCounts } from "@/app/play/[workId]/web-play-screenshot-db";
import type { WebPlayInstallation } from "@/app/play/[workId]/web-play-types";

export type LocalLibraryGame = {
  key: string; workId: number | null; title: string; playKey: string | null;
  coverBlobSha256: string | null; lastPlayedAt: string | null; needsMetadata: boolean;
  firstPlayedAt?: string | null; launchCount?: number;
  installations: WebPlayInstallation[]; saveNames: string[];
  screenshotCount: number;
};

export async function listLocalLibraryGames(): Promise<LocalLibraryGame[]> {
  const installations = await listWebPlayInstallations();
  const remembered = new Map((await listLocalLibraryWorks()).map(work => [work.workId, work]));
  const screenshots = await listScreenshotCounts();
  const ids = new Set([...remembered.keys(), ...screenshots.keys(),
    ...installations.flatMap(row => row.workId ? [row.workId] : [])]);
  for (const database of await indexedDB.databases()) {
    const match = /^\/work-saves\/([1-9]\d*)$/.exec(database.name ?? "");
    if (match && Number.isSafeInteger(Number(match[1]))) ids.add(Number(match[1]));
  }
  const games: LocalLibraryGame[] = [];
  for (const workId of ids) {
    const rows = installations.filter(row => row.workId === workId)
      .sort((a, b) => (b.lastPlayedAt ?? b.updatedAt).localeCompare(a.lastPlayedAt ?? a.updatedAt));
    const work = remembered.get(workId);
    const saves = await readSaveNames(workId);
    const shots = screenshots.get(workId);
    if (!rows.length && !work && !saves.length && !shots) continue;
    games.push({ key: `work:${workId}`, workId, title: rows[0]?.title ?? work?.title ?? `作品 ${workId}`,
      playKey: rows[0]?.playKey ?? work?.playKey ?? null,
      coverBlobSha256: rows[0]?.coverBlobSha256 ?? work?.coverBlobSha256 ?? null,
      lastPlayedAt: [work?.lastPlayedAt, ...rows.map(row => row.lastPlayedAt)].filter((value): value is string => !!value).sort().at(-1) ?? null,
      firstPlayedAt: work?.firstPlayedAt, launchCount: work?.launchCount,
      needsMetadata: !rows.length && !work, installations: rows, saveNames: saves,
      screenshotCount: shots ?? 0 });
  }
  for (const row of installations.filter(item => !item.workId)) games.push({
    key: row.playKey, workId: null, title: row.title, playKey: row.playKey,
    coverBlobSha256: row.coverBlobSha256 ?? null, lastPlayedAt: row.lastPlayedAt,
    needsMetadata: false, installations: [row], saveNames: [], screenshotCount: 0,
  });
  return games.sort((a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? "") || a.title.localeCompare(b.title, "zh-CN"));
}
