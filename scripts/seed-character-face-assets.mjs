import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getPlatformProxy } from "wrangler";

export async function seedCharacterFaceAssets({
  concurrency = 32,
  manifestPath = "data/character-face-sheets/manifest.json",
} = {}) {
  const absoluteManifestPath = resolve(manifestPath);
  const manifestDirectory = dirname(absoluteManifestPath);
  const manifest = JSON.parse(readFileSync(absoluteManifestPath, "utf8"));
  if (manifest.schema !== "viprpg-character-face-library.v2") {
    throw new Error("角色脸图清单格式不受支持");
  }
  const platform = await getPlatformProxy({
    configPath: resolve("wrangler.jsonc"),
    persist: true,
    remoteBindings: false,
  });
  try {
    const bucket = platform.env.ARCHIVE_BUCKET;
    if (
      !bucket ||
      typeof bucket.put !== "function" ||
      typeof bucket.list !== "function"
    ) {
      throw new Error("本地 ARCHIVE_BUCKET 绑定不可用");
    }
    const existingKeys = await listExistingKeys(bucket, "blobs/sha256/");
    const pendingSheets = manifest.sheets.filter(
      (sheet) => !existingKeys.has(blobKey(sheet.sha256)),
    );
    let cursor = 0;
    let completed = 0;
    const startedAt = Date.now();
    const timer = setInterval(
      () => report(completed, pendingSheets.length, manifest.sheets.length, startedAt),
      15_000,
    );
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(64, concurrency)) }, async () => {
        while (cursor < pendingSheets.length) {
          const sheet = pendingSheets[cursor++];
          const bytes = readFileSync(resolve(manifestDirectory, sheet.file));
          await bucket.put(blobKey(sheet.sha256), bytes, {
            httpMetadata: { contentType: sheet.contentType },
            customMetadata: {
              sha256: sheet.sha256,
              sizeBytes: String(sheet.sizeBytes),
            },
          });
          completed += 1;
        }
      }),
    );
    clearInterval(timer);
    report(completed, pendingSheets.length, manifest.sheets.length, startedAt);
  } finally {
    await platform.dispose();
  }
}

async function listExistingKeys(bucket, prefix) {
  const keys = new Set();
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const object of page.objects) keys.add(object.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

function report(completed, pending, total, startedAt) {
  console.log(
    `本地脸图对象：已存在 ${total - pending}/${total}，补传 ${completed}/${pending}，耗时 ${Math.round((Date.now() - startedAt) / 1000)} 秒`,
  );
}

function blobKey(sha256) {
  return `blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}
