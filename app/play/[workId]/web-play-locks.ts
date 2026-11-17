import { UiFeedbackError } from "@/lib/i18n/feedback";
export function gameResourceLockName(playKey: string): string {
  return `viprpg:game-resources:${playKey}`;
}

/** Saves belong to a Work, not a particular installed archive version. */
export function acquireGameSaveLock(workId: number, signal: AbortSignal): Promise<() => void> {
  return acquireSaveOperationLock(`viprpg:game-saves:${workId}`, signal);
}

function acquireSaveOperationLock(name: string, signal: AbortSignal): Promise<() => void> {
  if (!navigator.locks) return Promise.reject(new UiFeedbackError("play.save.locks"));
  return new Promise((resolve, reject) => {
    navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, async lock => {
      signal.throwIfAborted();
      if (!lock) throw new UiFeedbackError("play.save.inUse");
      await new Promise<void>(release => {
        const unlock = () => {
          signal.removeEventListener("abort", unlock);
          release();
        };
        signal.addEventListener("abort", unlock, { once: true });
        resolve(unlock);
      });
    }).catch(reject);
  });
}

/** Older open pages know only resource locks; keep their engines out of imports too. */
export async function acquireGameSaveTransferLock(workId: number, playKey: string | null, signal: AbortSignal): Promise<() => Promise<void>> {
  await acquireGameSaveLock(workId, signal);
  const held = new Set<string>();
  const refresh = async () => {
    const installations = await listWebPlayInstallations();
    signal.throwIfAborted();
    // Legacy records without a Work ID cannot safely be ruled out.
    const keys = new Set([...(playKey ? [playKey] : []), ...installations.filter(row => row.workId == null || row.workId === workId).map(row => row.playKey)]);
    for (const key of keys) {
      if (held.has(key)) continue;
      await acquireSaveOperationLock(gameResourceLockName(key), signal);
      held.add(key);
    }
  };
  await refresh();
  // Recheck before commit in case an older page installed another version during review.
  return refresh;
}

export async function withGameResourceWriteLock<T>(
  playKey: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!navigator.locks) throw new UiFeedbackError("play.install.error.lockUnsupported");
  return navigator.locks.request(
    gameResourceLockName(playKey),
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) throw new UiFeedbackError("play.install.error.lockBusy");
      return action();
    },
  );
}

/** Resolve only after acquisition; dispose releases the lifetime-held shared lock. */
export function acquireGameResourceReadLock(
  playKey: string,
  signal: AbortSignal,
): Promise<() => void> {
  if (!navigator.locks) return Promise.reject(new UiFeedbackError("play.install.error.lockUnsupported"));
  return new Promise((resolve, reject) => {
    navigator.locks.request(
      gameResourceLockName(playKey),
      { mode: "shared", ifAvailable: true },
      async (lock) => {
        signal.throwIfAborted();
        if (!lock) throw new UiFeedbackError("play.storage.error.busy");
        await new Promise<void>((release) => {
          const unlock = () => {
            signal.removeEventListener("abort", unlock);
            release();
          };
          signal.addEventListener("abort", unlock, { once: true });
          resolve(unlock);
        });
      },
    ).catch(reject);
  });
}
import { listWebPlayInstallations } from "./web-play-db";
