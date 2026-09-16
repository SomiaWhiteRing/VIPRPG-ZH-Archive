import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getPlatformProxy } from "wrangler";
import { seedCharacterFaceAssets } from "./seed-character-face-assets.mjs";

const { imageSize } = createRequire(import.meta.url)("next/dist/compiled/image-size");
const nameKey = (name) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const blobKey = (sha) => `blobs/sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;

export async function seedCharacterMaterials({ dryRun = false, manifestPath = "data/character-materials/manifest.json", faceManifestPath = "data/character-face-sheets/manifest.json" } = {}) {
  manifestPath = resolve(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schema !== "viprpg-character-material-library.v1" || !Array.isArray(manifest.materials)) {
    throw new Error("角色素材清单格式不受支持");
  }
  if (!dryRun) await seedCharacterFaceAssets({ manifestPath: faceManifestPath });
  const platform = await getPlatformProxy({
    configPath: resolve("wrangler.jsonc"),
    persist: { path: resolve(".wrangler/state/v3") },
    remoteBindings: false,
    envFiles: [],
  });
  try {
    const db = platform.env.DB;
    const bucket = platform.env.ARCHIVE_BUCKET;
    const [characters, aliases, blobs, characterSources] = await db.batch([
      db.prepare("SELECT id,original_name AS name FROM characters"),
      db.prepare("SELECT character_id AS id,name FROM character_aliases WHERE language='ja'"),
      db.prepare("SELECT sha256,size_bytes,status FROM blobs"),
      db.prepare("SELECT character_id AS characterId,url FROM character_sources ORDER BY character_id,sort_order,url"),
    ]);
    const pagesByCharacter = new Map();
    for (const source of characterSources.results) {
      if (!pagesByCharacter.has(source.characterId)) pagesByCharacter.set(source.characterId, []);
      pagesByCharacter.get(source.characterId).push(source.url);
    }
    const identities = new Map();
    for (const name of new Set(manifest.materials.flatMap((material) => material.boundOriginalNames))) {
      if (typeof name !== "string") throw new Error("素材角色名称格式不合法");
      const exact = characters.results.filter((row) => nameKey(row.name) === nameKey(name));
      const ids = new Set((exact.length ? exact : aliases.results.filter((row) => nameKey(row.name) === nameKey(name))).map((row) => row.id));
      if (ids.size !== 1) throw new Error(`角色归属缺失或不唯一：${name}`);
      identities.set(name, [...ids][0]);
    }
    const existingBlobs = new Map(blobs.results.map((blob) => [blob.sha256, blob]));
    const seen = new Set();
    const records = manifest.materials.map((material) => {
      if (!/^[a-f0-9]{64}$/.test(material.sha256) || !["charset", "monster", "other"].includes(material.kind)) {
        throw new Error("素材哈希或分类不合法");
      }
      const key = `${material.kind}:${material.sha256}`;
      if (seen.has(key)) throw new Error(`素材重复：${key}`);
      seen.add(key);
      if (!Array.isArray(material.boundOriginalNames) || !material.boundOriginalNames.length) throw new Error(`素材没有角色归属：${key}`);
      const fileMatch = /^assets\/([a-f0-9]{64})\.(png|gif|jpg|bmp)$/.exec(material.file);
      if (!fileMatch || fileMatch[1] !== material.sha256) throw new Error(`素材文件路径不合法：${key}`);
      const filePath = resolve(dirname(manifestPath), material.file);
      const bytes = readFileSync(filePath);
      if (bytes.length !== material.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== material.sha256) {
        throw new Error(`素材文件校验失败：${key}`);
      }
      const dimensions = imageSize(bytes);
      const contentType = { png: "image/png", gif: "image/gif", jpg: "image/jpeg", bmp: "image/bmp" }[dimensions.type];
      if (!dimensions.width || !dimensions.height || !contentType) {
        throw new Error(`素材图片尺寸或类型不合法：${key}`);
      }
      const existing = existingBlobs.get(material.sha256);
      if (existing && (existing.status !== "active" || existing.size_bytes !== bytes.length)) {
        throw new Error(`已有文件记录不可用：${key}`);
      }
      return { ...material, contentType, filePath, width: dimensions.width, height: dimensions.height,
        characterIds: [...new Set(material.boundOriginalNames.map((name) => identities.get(name)))] };
    });
    const counts = Object.fromEntries(["charset", "monster", "other"].map((kind) => [kind, records.filter((record) => record.kind === kind).length]));
    // A shared image follows each character's own source page, then any extra pages.
    const compareSources = (a, b) => a.pageRank - b.pageRank || a.pageUrl.localeCompare(b.pageUrl, "en", { numeric: true }) || a.sourceOrder - b.sourceOrder;
    const bindingsByCharacter = new Map();
    for (const record of records) {
      record.sortOrders = new Map();
      for (const characterId of record.characterIds) {
        const pages = pagesByCharacter.get(characterId) ?? [];
        const sources = record.sources.filter((source) => source.originalNames.some((name) => identities.get(name) === characterId)).map((source) => {
          if (!Number.isSafeInteger(source.sourceOrder) || source.sourceOrder < 0) throw new Error(`素材缺少源站顺序：${record.kind}:${record.sha256}`);
          const rank = pages.indexOf(source.pageUrl);
          return { ...source, pageRank: rank < 0 ? pages.length : rank };
        }).sort(compareSources);
        if (!sources.length) throw new Error(`素材缺少角色来源：${record.kind}:${record.sha256}`);
        if (!bindingsByCharacter.has(characterId)) bindingsByCharacter.set(characterId, []);
        bindingsByCharacter.get(characterId).push({ record, source: sources[0] });
      }
    }
    for (const [characterId, bindings] of bindingsByCharacter) {
      bindings.sort((a, b) => compareSources(a.source, b.source) || a.record.sha256.localeCompare(b.record.sha256));
      bindings.forEach(({ record }, order) => record.sortOrders.set(characterId, order));
    }
    const summary = { materials: records.length, bindings: records.reduce((sum, record) => sum + record.characterIds.length, 0), categories: counts };
    console.log(`素材清单校验完成：${JSON.stringify(summary)}`);
    if (dryRun) return summary;

    const objects = new Map();
    let listCursor;
    do {
      const page = await bucket.list({ prefix: "blobs/sha256/", cursor: listCursor, limit: 1000 });
      for (const object of page.objects) objects.set(object.key, object.size);
      listCursor = page.truncated ? page.cursor : undefined;
    } while (listCursor);
    const uniqueFiles = [...new Map(records.map((record) => [record.sha256, record])).values()];
    const pending = uniqueFiles.filter((record) => objects.get(blobKey(record.sha256)) !== record.sizeBytes);
    let cursor = 0;
    let uploaded = 0;
    const timer = setInterval(() => console.log(`本地素材图片：补传 ${uploaded}/${pending.length}`), 15_000);
    try {
      const uploads = await Promise.allSettled(Array.from({ length: 16 }, async () => {
        while (cursor < pending.length) {
          const record = pending[cursor++];
          const bytes = readFileSync(record.filePath);
          if (createHash("sha256").update(bytes).digest("hex") !== record.sha256) throw new Error(`导入期间文件发生改变：${record.file}`);
          await bucket.put(blobKey(record.sha256), bytes, {
            httpMetadata: { contentType: record.contentType },
            customMetadata: { sha256: record.sha256, sizeBytes: String(record.sizeBytes) },
          });
          uploaded++;
        }
      }));
      const failure = uploads.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
    } finally { clearInterval(timer); }

    for (let start = 0; start < records.length; start += 100) {
      const statements = records.slice(start, start + 100).flatMap((record) => [
        db.prepare(`INSERT INTO blobs(sha256,size_bytes,content_type_hint,observed_ext,verified_at)
          VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(sha256) DO UPDATE SET content_type_hint=excluded.content_type_hint,verified_at=excluded.verified_at`)
          .bind(record.sha256, record.sizeBytes, record.contentType, record.file.split(".").at(-1)),
        db.prepare("INSERT OR IGNORE INTO character_materials(blob_sha256,kind,width_px,height_px) VALUES (?,?,?,?)")
          .bind(record.sha256, record.kind, record.width, record.height),
        ...record.characterIds.map((characterId) => db.prepare(`INSERT INTO character_material_bindings(character_id,material_id,sort_order)
          SELECT ?,id,? FROM character_materials WHERE blob_sha256=? AND kind=?
          ON CONFLICT(character_id,material_id) DO UPDATE SET sort_order=excluded.sort_order`)
          .bind(characterId, record.sortOrders.get(characterId), record.sha256, record.kind)),
      ]);
      await db.batch(statements);
      if (start % 1000 === 0) console.log(`本地素材登记：${Math.min(start + 100, records.length)}/${records.length}`);
    }
    console.log(`本地素材导入完成：${JSON.stringify({ ...summary, uploaded })}`);
    return summary;
  } finally { await platform.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some((arg) => arg !== "--dry-run")) throw new Error("仅支持 --dry-run；此命令只操作本地 D1/R2。");
  await seedCharacterMaterials({ dryRun: process.argv.includes("--dry-run") });
}
