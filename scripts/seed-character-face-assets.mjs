import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { getPlatformProxy } from "wrangler";
const { imageSize } = createRequire(import.meta.url)("next/dist/compiled/image-size");

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
    persist: { path: resolve(".wrangler/state/v3") },
    remoteBindings: false,
    envFiles: [],
  });
  try {
    const database = platform.env.DB;
    const [characters, aliases] = await database.batch([
      database.prepare("SELECT id,original_name AS name FROM characters"),
      database.prepare("SELECT character_id AS id,name FROM character_aliases WHERE language='ja'"),
    ]);
    const key = (name) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    const identities = new Map();
    for (const name of new Set(manifest.sheets.flatMap((sheet) => sheet.boundOriginalNames))) {
      const exact = characters.results.filter((row) => key(row.name) === key(name));
      const ids = new Set((exact.length ? exact : aliases.results.filter((row) => key(row.name) === key(name))).map((row) => row.id));
      if (ids.size !== 1) throw new Error(`脸图归属缺失或不唯一：${name}`);
      identities.set(name, [...ids][0]);
    }
    const checkedSheets = manifest.sheets.map((sheet) => {
      if (!/^assets\/[a-f0-9]{64}\.(png|gif|jpg|bmp)$/.test(sheet.file)) throw new Error(`脸图路径无效：${sheet.file}`);
      const bytes = readFileSync(resolve(manifestDirectory, sheet.file));
      const dimensions = imageSize(bytes);
      if (createHash("sha256").update(bytes).digest("hex") !== sheet.sha256 || bytes.length !== sheet.sizeBytes || dimensions.width !== sheet.width || dimensions.height !== sheet.height) throw new Error(`脸图校验失败：${sheet.file}`);
      return { ...sheet, contentType: { png: "image/png", gif: "image/gif", jpg: "image/jpeg", bmp: "image/bmp" }[dimensions.type] };
    });
    const bucket = platform.env.ARCHIVE_BUCKET;
    if (
      !bucket ||
      typeof bucket.put !== "function" ||
      typeof bucket.list !== "function"
    ) {
      throw new Error("本地 ARCHIVE_BUCKET 绑定不可用");
    }
    const existingKeys = await listExistingKeys(bucket, "blobs/sha256/");
    const pendingSheets = checkedSheets.filter(
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
    for (let start = 0; start < checkedSheets.length; start += 100) {
      await database.batch(checkedSheets.slice(start, start + 100).flatMap((sheet) => {
        const source = sheet.sources[0];
        return [
          database.prepare("INSERT INTO blobs(sha256,size_bytes,content_type_hint,observed_ext,verified_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(sha256) DO UPDATE SET content_type_hint=excluded.content_type_hint")
            .bind(sheet.sha256,sheet.sizeBytes,sheet.contentType,sheet.file.split(".").at(-1)),
          database.prepare("INSERT OR IGNORE INTO face_sheets(blob_sha256,width_px,height_px,source_kind,source_page_url,source_image_url,source_page_title,source_section_title,source_order,library_status) VALUES (?,?,?,?,?,?,?,?,?,'approved')")
            .bind(sheet.sha256,sheet.width,sheet.height,sheet.sourceKind,source?.pageUrl??null,source?.imageUrl??null,source?.pageTitle??null,source?.sectionTitle??null,sheet.sourceOrder),
          ...sheet.boundOriginalNames.map((name) => database.prepare("INSERT OR IGNORE INTO character_face_sheet_bindings(character_id,face_sheet_id,sort_order) SELECT ?,id,? FROM face_sheets WHERE blob_sha256=? AND library_status='approved'")
            .bind(identities.get(name),sheet.sourceOrder,sheet.sha256)),
        ];
      }));
    }
    // Add configured defaults only for characters that do not yet have a portrait.
    for (const portrait of manifest.defaults) {
      const characterId = identities.get(portrait.originalName);
      if (!characterId) throw new Error(`默认头像角色不存在：${portrait.originalName}`);
      await database.batch([
        database.prepare(`INSERT OR IGNORE INTO character_portrait_refs(character_id,face_sheet_id,cell_row,cell_column)
          SELECT ?,fs.id,?,? FROM face_sheets fs JOIN character_face_sheet_bindings b ON b.face_sheet_id=fs.id AND b.character_id=?
          WHERE fs.blob_sha256=? AND fs.library_status='approved' AND NOT EXISTS(SELECT 1 FROM character_default_portraits WHERE character_id=?)`)
          .bind(characterId,portrait.row,portrait.column,characterId,portrait.sha256,characterId),
        database.prepare(`INSERT OR IGNORE INTO character_default_portraits(character_id,portrait_ref_id)
          SELECT ?,r.id FROM character_portrait_refs r JOIN face_sheets fs ON fs.id=r.face_sheet_id WHERE r.character_id=? AND fs.blob_sha256=? AND r.cell_row=? AND r.cell_column=?`)
          .bind(characterId,characterId,portrait.sha256,portrait.row,portrait.column),
      ]);
    }
    console.log(`脸图及角色绑定已登记：${checkedSheets.length} 张；已有默认头像保留。`);
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
