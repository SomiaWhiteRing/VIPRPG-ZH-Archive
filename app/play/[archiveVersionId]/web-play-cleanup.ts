import { deleteWebPlayInstallation, getWebPlayInstallation, listWebPlayInstallations } from "./web-play-db";
import { gameResourceLockName, withGameResourceWriteLock } from "./web-play-locks";
import { hasGameResources, resetGameOpfsDirectory } from "./web-play-opfs";
import type { WebPlayInstallation, WebPlayMetadata } from "./web-play-types";
import { isAndroidClient } from "@/lib/browser/client-environment";
import { gameResourceExpiresAt } from "./web-play-storage";
import { deleteUnusedWebPlayCovers } from "./web-play-cover";
import { notifyGameResourcesChanged } from "./web-play-events";

export async function canManageGameResources(): Promise<boolean> {
  return Boolean(navigator.locks);
}

async function removeInstallation(installation: WebPlayInstallation): Promise<void> {
  await resetGameOpfsDirectory(installation);
  await deleteWebPlayInstallation(installation.playKey);
}

async function cleanupCovers(removed: WebPlayInstallation[]): Promise<void> {
  if (!removed.length) return;
  const retained = await listWebPlayInstallations();
  await deleteUnusedWebPlayCovers(removed.map(row => row.coverBlobSha256), retained.map(row => row.coverBlobSha256));
}

export async function deleteLocalGame(playKey: string): Promise<void> {
  const removed: WebPlayInstallation[] = [];
  await withGameResourceWriteLock(playKey, async () => {
    const installation = await getWebPlayInstallation(playKey);
    if (!installation) return;
    await removeInstallation(installation);
    removed.push(installation);
  });
  // A failed cover cleanup must not misreport a successfully deleted game.
  await cleanupCovers(removed).catch(() => {});
  notifyGameResourcesChanged();
}

let pendingCleanup: Promise<void> | null = null;

/** Runs only for ordinary browsers. Per-game locks also protect installation and other tabs. */
export function cleanupExpiredGameResources(): Promise<void> {
  if (isAndroidClient() || typeof navigator === "undefined" || !navigator.locks) return Promise.resolve();
  if (pendingCleanup) return pendingCleanup;
  pendingCleanup = sweepExpiredGameResources().finally(() => { pendingCleanup = null; });
  return pendingCleanup;
}

async function sweepExpiredGameResources(): Promise<void> {
  await navigator.locks.request("viprpg:game-resource-cleanup", async () => {
    const removed: WebPlayInstallation[] = [];
    const failures: unknown[] = [];
    for (const row of await listWebPlayInstallations()) {
      try {
        await navigator.locks.request(gameResourceLockName(row.playKey), { mode: "exclusive", ifAvailable: true }, async lock => {
          if (!lock) return;
          const current = await getWebPlayInstallation(row.playKey);
          if (!current || current.storageKind === "android-opfs") return;
          const expires = gameResourceExpiresAt(current);
          // One-time reset of the old browser cache. Android never enters this sweep.
          const obsolete = !current.storageKind || (expires !== null && expires <= Date.now());
          if (!obsolete && await hasGameResources(current, current.status === "ready")) return;
          await removeInstallation(current);
          removed.push(current);
        });
      } catch (error) { failures.push(error); }
    }
    await cleanupCovers(removed).catch(() => {});
    if (removed.length) notifyGameResourcesChanged();
    if (failures.length) throw failures[0];
  });
}

export async function busyGameResourceKeys(): Promise<Set<string>> {
  if (!navigator.locks) return new Set();
  const { held } = await navigator.locks.query();
  const prefix = gameResourceLockName("");
  return new Set((held ?? []).flatMap(lock => lock.name?.startsWith(prefix) ? [lock.name.slice(prefix.length)] : []));
}

export async function cleanupObsoleteGameResources(metadata: WebPlayMetadata): Promise<{ removed: string[]; deferred: boolean }> {
  if (!(await canManageGameResources())) return { removed: [], deferred: true };
  // A stale tab must not treat its own version as the current one and delete newer data.
  const response = await fetch(`/api/archive-versions/${metadata.archiveVersionId}/web-play`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return { removed: [], deferred: false };
  const current = await response.json() as WebPlayMetadata;
  if (!current.ok || current.workId !== metadata.workId || current.archiveVersionId !== metadata.archiveVersionId) return { removed: [], deferred: false };

  return navigator.locks.request(
    gameResourceLockName(current.playKey),
    { mode: "shared", ifAvailable: true },
    async (lock) => {
      if (!lock || (await getWebPlayInstallation(current.playKey))?.status !== "ready") return { removed: [], deferred: false };
      const removed: string[] = [];
      const removedInstallations: WebPlayInstallation[] = [];
      let deferred = false;
      for (const installation of await listWebPlayInstallations()) {
        // Existing records predate workId; only their exact archive ID is known to match.
        if (installation.playKey === current.playKey ||
          (installation.workId !== current.workId && installation.archiveVersionId !== current.archiveVersionId)) continue;
        if (!/^av-\d+-[a-z0-9-]+$/.test(installation.playKey)) continue;
        await navigator.locks.request(
          gameResourceLockName(installation.playKey),
          { mode: "exclusive", ifAvailable: true },
          async (oldLock) => {
            if (!oldLock) {
              deferred = true;
              return;
            }
            const fresh = await getWebPlayInstallation(installation.playKey);
            if (!fresh) return;
            await removeInstallation(fresh);
            removedInstallations.push(fresh);
            removed.push(installation.playKey);
          },
        );
      }
      await cleanupCovers(removedInstallations).catch(() => {});
      if (removed.length) notifyGameResourcesChanged();
      return { removed, deferred };
    },
  );
}
