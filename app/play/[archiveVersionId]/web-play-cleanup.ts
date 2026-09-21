import { deleteWebPlayInstallation, getWebPlayInstallation, listWebPlayInstallations } from "./web-play-db";
import { gameResourceLockName } from "./web-play-locks";
import { resetGameOpfsDirectory } from "./web-play-opfs";
import type { WebPlayMetadata } from "./web-play-types";

// Older open pages cannot participate in Web Locks. No reply means defer, not idle.
export async function canManageGameResources(): Promise<boolean> {
  const controller = navigator.serviceWorker?.controller;
  if (!navigator.locks || !controller) return false;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (safe: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(safe);
    };
    const timer = setTimeout(() => finish(false), 2500);
    channel.port1.onmessage = (event) => finish(event.data?.safe === true);
    controller.postMessage({ type: "web-play-check-resource-locks" }, [channel.port2]);
  });
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
            await resetGameOpfsDirectory(installation.playKey);
            await deleteWebPlayInstallation(installation.playKey);
            navigator.serviceWorker.controller?.postMessage({ type: "web-play-forget-pack-index", playKey: installation.playKey });
            removed.push(installation.playKey);
          },
        );
      }
      return { removed, deferred };
    },
  );
}
