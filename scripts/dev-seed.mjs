// 本地开发数据：只写入 --local D1/R2。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, webcrypto } from "node:crypto";
import { deflateSync } from "node:zlib";
import { runWrangler } from "./run-wrangler.mjs";

const databaseName = process.env.LOCAL_D1_DATABASE || "viprpg-archive-prod";
const bucketName = process.env.LOCAL_R2_BUCKET || "viprpg-archive-prod";
const tmpDir = join(".wrangler", "tmp");
const seedSqlPath = join(tmpDir, "dev-seed.sql");
const NOW = "2026-07-01 12:00:00";
const characterDictionary = JSON.parse(
  readFileSync(new URL("../data/character-dictionary.json", import.meta.url), "utf8"),
);
if (characterDictionary.schema !== "viprpg-character-dictionary.v1") {
  throw new Error("角色词典格式不受支持");
}
if (process.argv.includes("--reset")) await import("./local-d1-reset.mjs");
mkdirSync(tmpDir, { recursive: true });

const images = [
  image("cover-a", 0x2c593b),
  image("cover-b", 0x052367),
  image("cover-c", 0x7c2d12),
  image("cover-d", 0x3b0764),
];
const emptyCorePack = Buffer.from("UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==", "base64");
const emptyCorePackSha256 = createHash("sha256")
  .update(emptyCorePack)
  .digest("hex");
const sql = [];
const quote = (value) =>
  value === null || value === undefined
    ? "NULL"
    : typeof value === "number"
      ? String(value)
      : `'${String(value).replace(/'/g, "''")}'`;
const insert = (table, rows) =>
  rows.forEach((row) =>
    sql.push(
      `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.values(row).map(quote).join(",")});`,
    ),
  );
const passwordHash = await hashPassword("dev123456789");

insert(
  "users",
  [1, 2, 3, 4].map((id) => ({
    id,
    external_auth_id: `dev-${id}`,
    email: [
      "super@dev.local",
      "admin@dev.local",
      "uploader@dev.local",
      "user@dev.local",
    ][id - 1],
    password_hash: passwordHash,
    display_name: ["开发超管", "开发管理员", "上传者小明", "普通访客甲"][
      id - 1
    ],
    status: "active",
    email_verified_at: NOW,
    created_at: NOW,
  })),
);
for (const [id, role] of [
  [1, "super_admin"],
  [2, "admin"],
  [3, "uploader"],
  [4, "user"],
]) {
  sql.push(
    `INSERT OR IGNORE INTO user_roles(user_id,role_id) SELECT ${id},id FROM roles WHERE key='user';`,
  );
  if (role !== "user")
    sql.push(
      `INSERT OR IGNORE INTO user_roles(user_id,role_id) SELECT ${id},id FROM roles WHERE key='${role}';`,
    );
}
insert(
  "blobs",
  images.map((item) => ({
    sha256: item.sha256,
    size_bytes: item.sizeBytes,
    content_type_hint: "image/png",
    observed_ext: "png",
    created_at: NOW,
  })),
);
insert(
  "media_assets",
  images.map((item, index) => ({
    id: index + 1,
    blob_sha256: item.sha256,
    kind: "preview",
    alt_text: `测试图 ${item.name}`,
    width: 320,
    height: 240,
    created_at: NOW,
  })),
);

insert("works", [
  game(1, "魔王の夏休み", "魔王的暑假", {
    language: "ja",
    description: "魔王决定给自己放一个暑假，结果勇者一行人也跟来了。",
    date: "2019-08-14",
  }),
  game(2, "魔王の夏休み", "魔王的暑假（中文译本）", {
    language: "zh-CN",
    isTranslation: 1,
    description: "魔王的暑假中文翻译。",
    date: "2019-08-14",
  }),
  game(3, "時空の狭間のモナー城", "时空夹缝中的莫娜城", {
    language: "ja",
    maniacs: 1,
    date: "2023-02-11",
  }),
  game(4, "夏之阵原创短篇", "夏之阵原创短篇", {
    language: "zh-CN",
    isOriginal: 1,
    date: "2026-06-20",
  }),
  game(5, "ギコの大冒険", null, {
    language: "ja",
    date: "2011-05-05",
  }),
  game(6, "未公開テスト作品", "未公开测试作品", {
    language: "ja",
    engine: "other",
    status: "hidden",
  }),
]);
insert("work_external_links", [
  {
    work_id: 6,
    label: "外部下载",
    url: "https://example.com/hidden-test-work",
    link_type: "download_page",
    created_at: NOW,
  },
]);
insert(
  "work_uploaders",
  [1, 2, 3, 4, 5, 6].map((work_id) => ({
    work_id,
    user_id: 3,
    created_at: NOW,
  })),
);
insert("work_titles", [
  { work_id: 1, title: "魔王暑假", title_type: "alias", created_at: NOW },
  {
    work_id: 1,
    title: "Maou Summer",
    language: "en",
    title_type: "alias",
    created_at: NOW,
  },
]);
insert("work_media_assets", [
  { work_id: 1, media_asset_id: 1, sort_order: 1, is_primary: 1 },
  { work_id: 2, media_asset_id: 1, sort_order: 1, is_primary: 1 },
  { work_id: 3, media_asset_id: 2, sort_order: 1, is_primary: 1 },
  { work_id: 4, media_asset_id: 3, sort_order: 1, is_primary: 1 },
]);
insert("work_relations", [
  {
    from_work_id: 3,
    to_work_id: 1,
    relation_type: "same_setting",
    vice_versa: 0,
    relation_order: 0,
    created_by_user_id: 3,
    created_at: NOW,
  },
  {
    from_work_id: 1,
    to_work_id: 3,
    relation_type: "same_setting",
    vice_versa: 1,
    relation_order: 0,
    created_by_user_id: 3,
    created_at: NOW,
  },
]);
insert("translation_relations", [
  {
    source_work_id: 2,
    target_role: "original",
    target_work_id: 1,
    vice_versa: 0,
    relation_order: 0,
    created_by_user_id: 3,
    created_at: NOW,
  },
  {
    source_work_id: 1,
    target_role: "translation",
    target_work_id: 2,
    vice_versa: 1,
    relation_order: 0,
    created_by_user_id: 3,
    created_at: NOW,
  },
]);
insert("catalogs", [
  {
    id: 1,
    owner_user_id: 3,
    title: "夏日精选",
    description: "适合夏天游玩的游戏。",
    cover_blob_sha256: images[3].sha256,
    status: "published",
    created_at: NOW,
    updated_at: NOW,
  },
]);
insert("catalog_items", [
  { catalog_id: 1, work_id: 1, sort_order: 0, note: "原版" },
  { catalog_id: 1, work_id: 2, sort_order: 1, note: "中文译本" },
  { catalog_id: 1, work_id: 4, sort_order: 2, note: "本站原创" },
]);

const seededCharacters = characterDictionary.characters.map((character, index) => ({
  id: index + 1,
  primary_name: character.primaryName,
  primary_name_key: nameKey(character.primaryName),
  original_name: character.originalName,
  original_name_key: nameKey(character.originalName),
  created_at: NOW,
  updated_at: NOW,
}));
for (const character of [
  { originalName: "モナー", primaryName: "莫纳", description: "猫耳角色。" },
  { originalName: "ギコ猫", primaryName: "吉可猫", description: "嘴硬的猫。" },
]) {
  seededCharacters.push({
    id: seededCharacters.length + 1,
    primary_name: character.primaryName,
    primary_name_key: nameKey(character.primaryName),
    original_name: character.originalName,
    original_name_key: nameKey(character.originalName),
    description: character.description,
    created_at: NOW,
    updated_at: NOW,
  });
}
insert("characters", seededCharacters);
let characterAliasId = 1;
insert(
  "character_aliases",
  characterDictionary.characters.flatMap((character, index) =>
    character.aliases.map((alias) => ({
      id: characterAliasId++,
      character_id: index + 1,
      name: alias.name,
      name_key: nameKey(alias.name),
      language: alias.language,
      source: alias.source,
      created_at: NOW,
    })),
  ),
);
const characterIds = new Map(
  seededCharacters.map((character) => [character.original_name, character.id]),
);
insert("work_characters", [
  { work_id: 1, character_id: characterIds.get("モナー"), display_name: "莫纳", role_key: "main", sort_order: 1 },
  { work_id: 1, character_id: characterIds.get("アゼクラ"), display_name: "阿泽库拉", role_key: "supporting", sort_order: 2 },
  { work_id: 3, character_id: characterIds.get("モナー"), display_name: "莫纳", role_key: "main", sort_order: 1 },
  { work_id: 3, character_id: characterIds.get("アゼクラ"), display_name: "校仓", role_key: "supporting", sort_order: 2 },
  { work_id: 5, character_id: characterIds.get("ギコ猫"), display_name: "吉可猫", role_key: "main", sort_order: 1 },
]);
insert("creators", [
  {
    id: 1,
    name: "名無し的制作人",
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 2,
    name: "本站原创作者",
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 3,
    name: "本地测试译者",
    created_at: NOW,
    updated_at: NOW,
  },
]);
insert("work_staff", [
  { work_id: 1, creator_id: 1, role_key: "author" },
  { work_id: 2, creator_id: 3, role_key: "translator", role_label: "译者" },
  { work_id: 3, creator_id: 1, role_key: "author" },
  { work_id: 4, creator_id: 2, role_key: "author" },
]);
insert("tags", [
  {
    id: 1,
    name: "短篇",
    namespace: "genre",
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 2,
    name: "本站原创",
    namespace: "technical",
    created_at: NOW,
    updated_at: NOW,
  },
]);
insert("work_tags", [
  { work_id: 1, tag_id: 1, source: "admin", created_at: NOW },
  { work_id: 4, tag_id: 1, source: "admin", created_at: NOW },
  { work_id: 4, tag_id: 2, source: "admin", created_at: NOW },
]);

const archives = [
  archive(1, 1, "ja", 214, 38_000_000, 1),
  archive(2, 2, "zh-CN", 216, 39_000_000, 1),
  archive(3, 3, "ja", 1024, 310_000_000, 1),
  archive(4, 4, "zh-CN", 156, 21_000_000, 1),
  archive(5, 5, "ja", 178, 26_000_000, 1),
];
insert(
  "archive_versions",
  archives.map((item) =>
    Object.fromEntries(
      Object.entries(item).filter(([key]) => key !== "manifestJson"),
    ),
  ),
);
insert("core_packs", [
  {
    id: 1,
    sha256: emptyCorePackSha256,
    size_bytes: emptyCorePack.length,
    uncompressed_size_bytes: 0,
    file_count: 0,
    format: "zip",
    compression: "deflate-low",
    created_at: NOW,
    verified_at: NOW,
    status: "active",
  },
]);
insert(
  "archive_version_core_pack_refs",
  archives.map((item) => ({ archive_version_id: item.id, core_pack_id: 1 })),
);
insert("import_jobs", [
  {
    id: 1,
    work_id: 2,
    archive_version_id: 2,
    uploader_id: 3,
    status: "completed",
    source_name: "中文译本",
    source_size_bytes: 39_000_000,
    file_count: 216,
    completed_at: NOW,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 2,
    uploader_id: 3,
    status: "failed",
    source_name: "损坏目录",
    source_size_bytes: 1_000_000,
    file_count: 2,
    failed_stage: "preflight",
    error_message: "测试失败",
    created_at: NOW,
    updated_at: NOW,
  },
]);
insert("download_builds", [
  {
    archive_version_id: 2,
    manifest_sha256: archives[1].manifest_sha256,
    status: "ready",
    size_bytes: 39_000_000,
    download_count: 4,
    cache_hit_count: 3,
    cache_miss_count: 1,
    created_at: NOW,
    last_accessed_at: NOW,
  },
]);

writeFileSync(seedSqlPath, `${sql.join("\n")}\n`);
await runWrangler([
  "d1",
  "execute",
  databaseName,
  "--local",
  "--file",
  seedSqlPath,
]);
for (const item of images) {
  const path = join(tmpDir, `dev-seed-${item.name}.png`);
  writeFileSync(path, item.png);
  await runWrangler([
    "r2",
    "object",
    "put",
    `${bucketName}/${blobKey(item.sha256)}`,
    "--local",
    "--file",
    path,
    "--content-type",
    "image/png",
  ]);
}
const corePackPath = join(tmpDir, "dev-seed-core-pack.zip");
writeFileSync(corePackPath, emptyCorePack);
await runWrangler([
  "r2",
  "object",
  "put",
  `${bucketName}/${corePackKey(emptyCorePackSha256)}`,
  "--local",
  "--file",
  corePackPath,
  "--content-type",
  "application/zip",
]);
for (const item of archives) {
  const path = join(tmpDir, `dev-seed-manifest-${item.id}.json`);
  writeFileSync(path, item.manifestJson);
  await runWrangler([
    "r2",
    "object",
    "put",
    `${bucketName}/${manifestKey(item.manifest_sha256)}`,
    "--local",
    "--file",
    path,
    "--content-type",
    "application/json",
  ]);
}
console.log(
  "本地测试数据已写入。账号密码均为 dev123456789：super@dev.local / admin@dev.local / uploader@dev.local / user@dev.local",
);

function game(id, originalTitle, chineseTitle, options = {}) {
  const status = options.status ?? "published";
  return {
    id,
    original_title: originalTitle,
    chinese_title: chineseTitle,
    description: options.description ?? null,
    is_original: options.isOriginal ?? 0,
    is_translation: options.isTranslation ?? 0,
    language: options.language ?? "zh-CN",
    original_release_date: options.date ?? null,
    original_release_precision: options.date ? "day" : "unknown",
    engine_family: options.maniacs
      ? "rpg_maker_2003_maniac"
      : (options.engine ?? "rpg_maker_2000"),
    status,
    created_by_user_id: 3,
    created_at: NOW,
    updated_at: NOW,
    published_at: status === "published" ? NOW : null,
  };
}
function archive(id, work_id, language, files, size, current) {
  const info = {
    1: {
      title: "魔王の夏休み",
      isOriginal: false,
      isTranslation: false,
    },
    2: {
      title: "魔王の夏休み",
      isOriginal: false,
      isTranslation: true,
    },
    3: {
      title: "時空の狭間のモナー城",
      isOriginal: false,
      isTranslation: false,
    },
    4: {
      title: "夏之阵原创短篇",
      isOriginal: true,
      isTranslation: false,
    },
    5: { title: "ギコの大冒険", isOriginal: false, isTranslation: false },
  }[work_id];
  const manifestJson = JSON.stringify({
    schema: "viprpg-archive.manifest.v1",
    game: {
      originalTitle: info.title,
      chineseTitle: null,
      language,
      isOriginal: info.isOriginal,
      isTranslation: info.isTranslation,
    },
    archiveVersion: {
      sourceName: null,
      sourceUrl: null,
      createdAt: NOW,
      filePolicyVersion: "v1",
      packerVersion: "dev-seed",
      sourceType: "browser_folder",
      sourceFileCount: 0,
      sourceSize: 0,
      includedFileCount: 0,
      includedSize: 0,
      excludedFileCount: 0,
      excludedSize: 0,
    },
    corePacks: [
      {
        id: "core-main",
        sha256: emptyCorePackSha256,
        size: emptyCorePack.length,
        uncompressedSize: 0,
        fileCount: 0,
        format: "zip",
        compression: "deflate-low",
      },
    ],
    files: [],
  });
  const manifest_sha256 = createHash("sha256")
    .update(manifestJson)
    .digest("hex");
  return {
    id,
    work_id,
    source_name: null,
    source_url: null,
    manifest_sha256,
    manifestJson,
    file_policy_version: "v1",
    packer_version: "dev-seed",
    source_type: "browser_folder",
    source_file_count: files,
    source_size_bytes: size,
    total_files: files,
    total_size_bytes: size,
    unique_blob_size_bytes: Math.floor(size * 0.6),
    core_pack_count: 1,
    core_pack_size_bytes: emptyCorePack.length,
    estimated_r2_get_count: Math.max(1, Math.ceil(files / 40)),
    web_play_file_count: 0,
    web_play_size_bytes: 0,
    is_current: current,
    uploader_id: 3,
    status: "published",
    created_at: NOW,
    published_at: NOW,
  };
}
function blobKey(sha) {
  return `blobs/sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;
}
function nameKey(value) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}
function corePackKey(sha) {
  return `core-packs/sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.zip`;
}
function manifestKey(sha) {
  return `manifests/sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}.json`;
}
function image(name, color) {
  const width = 320,
    height = 240,
    raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const off = y * (1 + width * 3);
    raw[off] = 0;
    for (let x = 0; x < width; x++) {
      const c = ((x >> 4) + (y >> 4)) % 2 ? color : color ^ 0x223344;
      raw[off + 1 + x * 3] = (c >> 16) & 255;
      raw[off + 2 + x * 3] = (c >> 8) & 255;
      raw[off + 3 + x * 3] = c & 255;
    }
  }
  const png = pngEncode(width, height, raw);
  return {
    name,
    png,
    sha256: createHash("sha256").update(png).digest("hex"),
    sizeBytes: png.length,
  };
}
function pngEncode(width, height, raw) {
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk(
      "IHDR",
      (() => {
        const b = Buffer.alloc(13);
        b.writeUInt32BE(width, 0);
        b.writeUInt32BE(height, 4);
        b[8] = 8;
        b[9] = 2;
        return b;
      })(),
    ),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const b = Buffer.alloc(4);
  b.writeUInt32BE(data.length, 0);
  const out = Buffer.concat([b, body, Buffer.alloc(4)]);
  out.writeUInt32BE(crc32(body), out.length - 4);
  return out;
}
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    key,
    256,
  );
  const b = (v) => Buffer.from(v).toString("base64url");
  return `pbkdf2-sha256$100000$${b(salt)}$${b(new Uint8Array(bits))}`;
}
