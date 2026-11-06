import { sha256Hex } from "@/lib/sha256";
import type { WebPlayInstallation, WebPlayStorageKind } from "./web-play-types";
import { readGameRetentionDays, type GameRetentionDays } from "./web-play-retention";

// Existing Chromium buckets cannot clear an expiry. Use the largest Date value
// for "never"; application expiry remains null and no resource files are moved.
const noAutomaticExpiry = 8_640_000_000_000_000;

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
  return supportsGameBuckets() ? "browser-bucket" : "browser-opfs";
}

export function gameResourceExpiresAt(installation: WebPlayInstallation, retention: GameRetentionDays): number | null {
  if (!installation.storageKind || retention === "never") return null;
  const base = installation.status === "ready"
    ? installation.lastPlayedAt ?? installation.readyAt ?? installation.createdAt
    : installation.updatedAt;
  const time = Date.parse(base);
  return Number.isFinite(time) ? time + retention * 24 * 60 * 60 * 1000 : 0;
}

export function validatePlayKey(playKey: string): void {
  if (!/^av-\d+-[a-z0-9-]+$/.test(playKey)) throw new Error("非法游戏安装标识。");
}

async function bucketName(playKey: string): Promise<string> {
  validatePlayKey(playKey);
  const digest = await sha256Hex(new TextEncoder().encode(playKey));
  return `viprpg-game-${digest.slice(0, 48)}`;
}

export async function openGameBucket(installation: WebPlayInstallation, create: boolean, retention?: GameRetentionDays): Promise<GameBucket> {
  const manager = buckets();
  if (!manager) throw new Error("当前浏览器无法读取已安装的游戏资源。");
  const name = await bucketName(installation.playKey);
  const expires = gameResourceExpiresAt(installation, retention ?? await readGameRetentionDays());
  if (expires !== null && expires <= Date.now()) throw new DOMException("游戏资源已过期。", "NotFoundError");
  // Opening an absent bucket would silently create it. Check first when reading.
  if (!create && !(await manager.keys()).includes(name)) throw new DOMException("游戏资源已被清理。", "NotFoundError");
  // Always supply the existing deadline: opening a bucket must not renew it just by browsing.
  return manager.open(name, { expires: expires ?? noAutomaticExpiry, persisted: false });
}

export async function deleteGameBucket(playKey: string): Promise<void> {
  const manager = buckets();
  if (!manager) throw new Error("当前浏览器无法清理已安装的游戏资源。");
  await manager.delete(await bucketName(playKey));
}

export async function renewGameBucket(installation: WebPlayInstallation, retention?: GameRetentionDays): Promise<void> {
  if (installation.storageKind !== "browser-bucket") return;
  const days = retention ?? await readGameRetentionDays();
  const bucket = await openGameBucket(installation, false, days);
  await bucket.setExpires(gameResourceExpiresAt(installation, days) ?? noAutomaticExpiry);
}
