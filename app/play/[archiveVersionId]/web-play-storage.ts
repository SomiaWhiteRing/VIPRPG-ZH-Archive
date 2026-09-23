import { isAndroidClient } from "@/lib/browser/client-environment";
import type { WebPlayInstallation, WebPlayStorageKind } from "./web-play-types";

export const GAME_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type GameBucket = {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
  setExpires(expires: number): Promise<void>;
};
type GameBucketManager = {
  open(name: string, options: { expires: number; persisted: false }): Promise<GameBucket>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<void>;
};

function buckets(): GameBucketManager | undefined {
  return (navigator as Navigator & { storageBuckets?: GameBucketManager }).storageBuckets;
}

export function supportsGameBuckets(): boolean {
  const manager = buckets();
  return typeof manager?.open === "function" && typeof manager.keys === "function" && typeof manager.delete === "function";
}

/** Called in the page; Workers must receive this choice in their install message. */
export function chooseGameStorage(): WebPlayStorageKind {
  if (isAndroidClient()) return "android-opfs";
  return supportsGameBuckets() ? "browser-bucket" : "browser-opfs";
}

export function gameResourceExpiresAt(installation: WebPlayInstallation): number | null {
  if (installation.storageKind === "android-opfs" || !installation.storageKind) return null;
  const base = installation.status === "ready"
    ? installation.lastPlayedAt ?? installation.readyAt ?? installation.createdAt
    : installation.updatedAt;
  const time = Date.parse(base);
  return Number.isFinite(time) ? time + GAME_RETENTION_MS : 0;
}

export function validatePlayKey(playKey: string): void {
  if (!/^av-\d+-[a-z0-9-]+$/.test(playKey)) throw new Error("非法游戏安装标识。");
}

async function bucketName(playKey: string): Promise<string> {
  validatePlayKey(playKey);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(playKey));
  return `viprpg-game-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 48)}`;
}

export async function openGameBucket(installation: WebPlayInstallation, create: boolean): Promise<GameBucket> {
  const manager = buckets();
  if (!manager) throw new Error("当前浏览器无法读取已安装的游戏资源。");
  const name = await bucketName(installation.playKey);
  const expires = gameResourceExpiresAt(installation);
  if (expires === null || expires <= Date.now()) throw new DOMException("游戏资源已过期。", "NotFoundError");
  // Opening an absent bucket would silently create it. Check first when reading.
  if (!create && !(await manager.keys()).includes(name)) throw new DOMException("游戏资源已被清理。", "NotFoundError");
  // Always supply the existing deadline: opening a bucket must not renew it just by browsing.
  return manager.open(name, { expires, persisted: false });
}

export async function deleteGameBucket(playKey: string): Promise<void> {
  const manager = buckets();
  if (!manager) throw new Error("当前浏览器无法清理已安装的游戏资源。");
  await manager.delete(await bucketName(playKey));
}

export async function renewGameBucket(installation: WebPlayInstallation): Promise<void> {
  if (installation.storageKind !== "browser-bucket") return;
  const bucket = await openGameBucket(installation, false);
  await bucket.setExpires(gameResourceExpiresAt(installation)!);
}
