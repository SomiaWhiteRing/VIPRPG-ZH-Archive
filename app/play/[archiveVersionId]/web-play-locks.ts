export function gameResourceLockName(playKey: string): string {
  return `viprpg:game-resources:${playKey}`;
}

export async function withGameResourceWriteLock<T>(
  playKey: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!navigator.locks) throw new Error("当前浏览器不支持安全管理本地游戏文件。");
  return navigator.locks.request(
    gameResourceLockName(playKey),
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) throw new Error("其他页面正在使用或安装这个版本，请停止游戏后重试。");
      return action();
    },
  );
}

/** Resolve only after acquisition; dispose releases the lifetime-held shared lock. */
export function acquireGameResourceReadLock(
  playKey: string,
  signal: AbortSignal,
): Promise<() => void> {
  if (!navigator.locks) return Promise.reject(new Error("当前浏览器不支持安全管理本地游戏文件。"));
  return new Promise((resolve, reject) => {
    navigator.locks.request(
      gameResourceLockName(playKey),
      { mode: "shared", ifAvailable: true },
      async (lock) => {
        signal.throwIfAborted();
        if (!lock) throw new Error("这个版本正在安装或清理，请稍后重试。");
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
