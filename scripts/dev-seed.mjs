// 本地开发用测试数据：仅写入 --local 的 D1 与 R2，不触碰远端资源。
// 用法：
//   node scripts/dev-seed.mjs          # 向空库插入测试数据
//   node scripts/dev-seed.mjs --reset  # 先重置本地库（等价 npm run db:local:reset）再插入
// 所有测试账号密码均为 dev1234567。
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createHash, webcrypto } from "node:crypto";
import { deflateSync } from "node:zlib";

const databaseName = process.env.LOCAL_D1_DATABASE || "viprpg-archive-prod";
const bucketName = process.env.LOCAL_R2_BUCKET || "viprpg-archive-prod";
const tmpDir = join(".wrangler", "tmp");
const seedSqlPath = join(tmpDir, "dev-seed.sql");

const SEED_PASSWORD = "dev1234567";
const NOW = "2026-07-01 12:00:00";

if (process.argv.includes("--reset")) {
  run("node", ["scripts/local-d1-reset.mjs"]);
}

mkdirSync(tmpDir, { recursive: true });

// ---- 图片素材（生成像素风 PNG，写入本地 R2） ---------------------------

let crcTable;

const images = [
  makeImage("cover-a", 320, 180, [0x2c593b, 0x507d5f, 0xfffd87, 0x1a4729]),
  makeImage("cover-b", 320, 180, [0x052367, 0x2a78d4, 0xf0faff, 0x075fd4]),
  makeImage("cover-c", 320, 180, [0x7c2d12, 0xf97316, 0xffebcd, 0x431407]),
  makeImage("cover-d", 320, 180, [0x3b0764, 0xa855f7, 0xfdf4ff, 0x581c87]),
  makeImage("shot-a", 320, 240, [0x14532d, 0x22c55e, 0xdcfce7, 0x052e16]),
  makeImage("shot-b", 320, 240, [0x7f1d1d, 0xef4444, 0xfee2e2, 0x450a0a]),
];

function makeImage(name, width, height, palette) {
  const cell = 16;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const pick = (cx * 7 + cy * 13 + ((cx * cy) % 5)) % palette.length;
      const color = palette[pick];
      row[1 + x * 3] = (color >> 16) & 0xff;
      row[2 + x * 3] = (color >> 8) & 0xff;
      row[3 + x * 3] = color & 0xff;
    }
    rows.push(row);
  }
  const png = encodePng(width, height, Buffer.concat(rows));
  const sha256 = createHash("sha256").update(png).digest("hex");
  return { name, png, sha256, sizeBytes: png.length };
}

function encodePng(width, height, raw) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(buffer) {
  crcTable ??= buildCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function blobR2Key(sha256) {
  return `blobs/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

// ---- 密码哈希（与 lib/server/auth/password.ts 相同格式） ----------------

async function hashPassword(password) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
    keyMaterial,
    256,
  );
  const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
  return ["pbkdf2-sha256", "100000", b64(salt), b64(new Uint8Array(bits))].join("$");
}

// ---- SQL 组装 -----------------------------------------------------------

const sql = [];

function insert(table, rows) {
  for (const row of rows) {
    const keys = Object.keys(row);
    const values = keys.map((key) => literal(row[key])).join(", ");
    sql.push(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${values});`);
  }
}

function literal(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

const passwordHash = await hashPassword(SEED_PASSWORD);

insert("users", [
  user(1, "super@dev.local", "开发超管", "super_admin"),
  user(2, "admin@dev.local", "开发管理员", "admin"),
  user(3, "uploader@dev.local", "上传者小明", "uploader"),
  user(4, "user@dev.local", "普通访客甲", "user"),
]);

function user(id, email, displayName, roleKey) {
  return {
    id,
    external_auth_id: `dev-${id}`,
    email,
    password_hash: passwordHash,
    display_name: displayName,
    role_key: roleKey,
    status: "active",
    email_verified_at: NOW,
    created_at: NOW,
  };
}

insert("blobs", images.map((image) => ({
  sha256: image.sha256,
  size_bytes: image.sizeBytes,
  content_type_hint: "image/png",
  observed_ext: "png",
  created_at: NOW,
})));

insert("media_assets", images.map((image, index) => ({
  id: index + 1,
  blob_sha256: image.sha256,
  kind: image.name.startsWith("shot") ? "screenshot" : "preview",
  alt_text: `测试图 ${image.name}`,
  width: 320,
  height: image.name.startsWith("shot") ? 240 : 180,
  created_at: NOW,
})));

// 作品：覆盖长标题、日文标题、无图、多版本、Maniacs、草稿/隐藏等情况。
insert("works", [
  work(1, "maou-no-natsuyasumi", "魔王の夏休み", "魔王的暑假", {
    description:
      "魔王决定给自己放一个暑假，结果勇者一行人也跟来了。约 1 小时的短篇喜剧。",
    engine: "rpg_maker_2000",
    date: "2019-08-14",
    thumbnail: images[0].sha256,
    updatedAt: "2026-06-28 09:00:00",
  }),
  work(2, "monar-castle-hazama", "時空の狭間のモナー城", "时空夹缝中的莫娜城", {
    description:
      "莫娜城系列第三作。城堡被卷入时空夹缝，需要在过去与未来之间往返解谜。使用 Maniacs Patch。",
    engine: "rpg_maker_2003",
    date: "2023-02-11",
    maniacs: 1,
    thumbnail: images[1].sha256,
    updatedAt: "2026-06-20 21:30:00",
  }),
  work(3, "shitennou-nichijou", "四天王の日常", "四天王的日常", {
    description: "魔王军四天王的日常小剧场合集，全部选项都会通向奇怪的结局。",
    engine: "rpg_maker_2000",
    date: "2016-12-30",
    thumbnail: images[2].sha256,
    updatedAt: "2026-06-15 18:00:00",
  }),
  work(4, "kouhaku-daibousou-sp", "超長編クソゲー外伝～真夏の紅白祭りで大暴走スペシャル完全版～", "超长篇粪作外传～盛夏红白祭大暴走特别完全版～", {
    description:
      "标题很长本体也很长。用来测试长标题换行的红白祭投稿作，剧情横跨十二个章节。",
    engine: "rpg_maker_2003",
    date: "2024-08-01",
    updatedAt: "2026-06-10 12:00:00",
  }),
  work(5, "giko-no-bouken", "ギコの大冒険", null, {
    description: "只有日文原名、没有中文名的测试条目。吉科猫踏上寻找终点的旅途。",
    engine: "rpg_maker_2000",
    date: "2011-05-05",
    updatedAt: "2026-05-30 08:00:00",
  }),
  work(6, "dokuo-quest", "ドクオクエスト", "毒男奇幻旅", {
    description: "王道 RPG 结构的中篇，收录原版与两个汉化修正版，适合测试版本列表。",
    engine: "rpg_maker_2000",
    date: "2014-11-23",
    thumbnail: images[3].sha256,
    updatedAt: "2026-05-12 16:45:00",
  }),
  work(7, "yaruo-densetsu", "やる夫の伝説", "阿部传说", {
    description: "引擎未知的老作品，仅存一个来源不明的重打包归档。",
    engine: "unknown",
    dateUnknown: true,
    updatedAt: "2026-04-01 10:00:00",
  }),
  work(8, "monar-castle", "モナー城", "莫娜城", {
    description: "莫娜城系列第一作，也是同世界观一系列作品的起点。",
    engine: "rpg_maker_2000",
    date: "2009-01-15",
    updatedAt: "2026-03-20 14:00:00",
  }),
  // 非公开状态：不应出现在公共页面
  work(9, "draft-only", "未公開テスト作品", "未公开测试作品", {
    description: "status=draft，不应出现在公共列表。",
    engine: "rpg_maker_2000",
    status: "draft",
    updatedAt: "2026-06-01 00:00:00",
  }),
  work(10, "hidden-only", "非表示テスト作品", "已隐藏测试作品", {
    description: "status=hidden，不应出现在公共列表。",
    engine: "rpg_maker_2000",
    status: "hidden",
    updatedAt: "2026-06-01 00:00:00",
  }),
]);

function work(id, slug, originalTitle, chineseTitle, options) {
  return {
    id,
    slug,
    original_title: originalTitle,
    chinese_title: chineseTitle,
    sort_title: chineseTitle ?? originalTitle,
    description: options.description ?? null,
    original_release_date: options.dateUnknown ? null : options.date,
    original_release_precision: options.dateUnknown ? "unknown" : "day",
    engine_family: options.engine,
    uses_maniacs_patch: options.maniacs ?? 0,
    thumbnail_blob_sha256: options.thumbnail ?? null,
    status: options.status ?? "published",
    created_by_user_id: 3,
    created_at: NOW,
    updated_at: options.updatedAt ?? NOW,
    published_at: (options.status ?? "published") === "published" ? NOW : null,
  };
}

insert("work_titles", [
  { work_id: 1, title: "魔王暑假", title_type: "alias", created_at: NOW },
  { work_id: 1, title: "Maou Summer", language: "en", title_type: "alias", created_at: NOW },
  { work_id: 6, title: "DQuest", title_type: "alias", created_at: NOW },
]);

insert("work_media_assets", [
  { work_id: 1, media_asset_id: 1, sort_order: 1, is_primary: 1 },
  { work_id: 1, media_asset_id: 5, sort_order: 2, is_primary: 0 },
  { work_id: 1, media_asset_id: 6, sort_order: 3, is_primary: 0 },
  { work_id: 2, media_asset_id: 2, sort_order: 1, is_primary: 1 },
  { work_id: 3, media_asset_id: 3, sort_order: 1, is_primary: 1 },
  { work_id: 6, media_asset_id: 4, sort_order: 1, is_primary: 1 },
]);

insert("series", [
  {
    id: 1,
    slug: "monar-castle-series",
    title: "莫娜城系列",
    title_original: "モナー城シリーズ",
    description: "围绕莫娜城展开的系列作品与外传。",
    status: "published",
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 2,
    slug: "kouhaku-2024",
    title: "红白祭 2024 投稿合集",
    title_original: "VIPRPG紅白2024",
    description: "2024 年红白祭相关投稿作品。",
    status: "published",
    created_at: NOW,
    updated_at: NOW,
  },
]);

insert("work_series", [
  { series_id: 1, work_id: 8, position_number: 1, position_label: "第一作", relation_kind: "main" },
  { series_id: 1, work_id: 2, position_number: 3, position_label: "第三作", relation_kind: "main" },
  { series_id: 2, work_id: 4, position_label: "投稿 12 号", relation_kind: "collection_member" },
]);

insert("work_relations", [
  { from_work_id: 8, to_work_id: 2, relation_type: "sequel", created_at: NOW },
  { from_work_id: 3, to_work_id: 1, relation_type: "same_setting", created_at: NOW },
]);

insert("characters", [
  character(1, "monar", "モナー", "猫耳原点角色，出场率最高。"),
  character(2, "giko", "ギコ猫", "说话带刺但心地不坏的猫。"),
  character(3, "shii", "しぃ", "温柔挂角色，经常被卷入事件。"),
  character(4, "yaruo", "やる夫", "圆脸主角，什么活都接。"),
  character(5, "dokuo", "ドクオ", "独身男代表，自带哀愁 BGM。"),
]);

function character(id, slug, primaryName, description) {
  return {
    id,
    slug,
    primary_name: primaryName,
    description,
    created_at: NOW,
    updated_at: NOW,
  };
}

insert("work_characters", [
  { work_id: 1, character_id: 1, role_key: "main", sort_order: 1 },
  { work_id: 1, character_id: 3, role_key: "supporting", sort_order: 2 },
  { work_id: 2, character_id: 1, role_key: "main", sort_order: 1 },
  { work_id: 2, character_id: 2, role_key: "supporting", sort_order: 2 },
  { work_id: 3, character_id: 2, role_key: "main", sort_order: 1 },
  { work_id: 5, character_id: 2, role_key: "main", sort_order: 1 },
  { work_id: 6, character_id: 5, role_key: "main", sort_order: 1 },
  { work_id: 7, character_id: 4, role_key: "main", sort_order: 1 },
  { work_id: 8, character_id: 1, role_key: "main", sort_order: 1 },
  { work_id: 8, character_id: 3, role_key: "cameo", sort_order: 2 },
]);

insert("creators", [
  creator(1, "nanashi-a", "名無しの製作者A"),
  creator(2, "vip-hanhua-zu", "VIP汉化组"),
  creator(3, "jiaodui-jun", "校对君"),
  creator(4, "xiu-tu-xia", "修图侠"),
  creator(5, "monar-koubou", "モナー工房"),
]);

function creator(id, slug, name) {
  return { id, slug, name, created_at: NOW, updated_at: NOW };
}

insert("work_staff", [
  { work_id: 1, creator_id: 1, role_key: "author" },
  { work_id: 2, creator_id: 5, role_key: "author" },
  { work_id: 3, creator_id: 1, role_key: "author" },
  { work_id: 4, creator_id: 1, role_key: "author" },
  { work_id: 5, creator_id: 5, role_key: "author" },
  { work_id: 6, creator_id: 1, role_key: "author" },
  { work_id: 8, creator_id: 5, role_key: "author" },
]);

insert("tags", [
  tag(1, "neta", "捏他", "genre"),
  tag(2, "short", "短篇", "genre"),
  tag(3, "long", "长篇", "genre"),
  tag(4, "horror", "恐怖", "theme"),
  tag(5, "kusoge", "粪作", "content"),
  tag(6, "kouhaku", "红白祭", "theme"),
  tag(7, "natsu-no-jin", "夏之阵", "theme"),
  tag(8, "maniacs", "Maniacs", "technical"),
]);

function tag(id, slug, name, namespace) {
  return { id, slug, name, namespace, created_at: NOW, updated_at: NOW };
}

insert("work_tags", [
  { work_id: 1, tag_id: 1, created_at: NOW },
  { work_id: 1, tag_id: 2, created_at: NOW },
  { work_id: 1, tag_id: 7, created_at: NOW },
  { work_id: 2, tag_id: 3, created_at: NOW },
  { work_id: 2, tag_id: 8, created_at: NOW },
  { work_id: 3, tag_id: 1, created_at: NOW },
  { work_id: 3, tag_id: 2, created_at: NOW },
  { work_id: 4, tag_id: 3, created_at: NOW },
  { work_id: 4, tag_id: 5, created_at: NOW },
  { work_id: 4, tag_id: 6, created_at: NOW },
  { work_id: 5, tag_id: 2, created_at: NOW },
  { work_id: 6, tag_id: 3, created_at: NOW },
  { work_id: 8, tag_id: 1, created_at: NOW },
]);

// 发布版本与归档快照：作品 6 有原版 + 汉化 + 修正三个 Release。
insert("releases", [
  release(1, 1, "original", "原始发布", { type: "original", date: "2019-08-14" }),
  release(2, 1, "zh-v1", "汉化 v1.0", { type: "translation", date: "2021-03-05" }),
  release(3, 2, "original", "原始发布", { type: "original", date: "2023-02-11" }),
  release(4, 3, "original", "原始发布", { type: "original", date: "2016-12-30" }),
  release(5, 4, "kouhaku-entry", "红白祭投稿版", { type: "event_submission", date: "2024-08-01" }),
  release(6, 5, "original", "原始发布", { type: "original", date: "2011-05-05" }),
  release(7, 6, "original", "原始发布", { type: "original", date: "2014-11-23" }),
  release(8, 6, "zh-v1", "汉化 v1.0", { type: "translation", date: "2018-06-17" }),
  release(9, 6, "zh-v2", "汉化修正 v2.1", { type: "localized_revision", date: "2020-09-30" }),
  release(10, 7, "repack", "来源不明重打包", { type: "repack", dateUnknown: true }),
  release(11, 8, "original", "原始发布", { type: "original", date: "2009-01-15" }),
]);

function release(id, workId, key, label, options) {
  return {
    id,
    work_id: workId,
    release_key: key,
    release_label: label,
    release_type: options.type,
    release_date: options.dateUnknown ? null : options.date,
    release_date_precision: options.dateUnknown ? "unknown" : "day",
    status: "published",
    created_by_user_id: 3,
    created_at: NOW,
    updated_at: NOW,
    published_at: NOW,
  };
}

insert("release_staff", [
  { release_id: 2, creator_id: 2, role_key: "translator" },
  { release_id: 2, creator_id: 3, role_key: "proofreader" },
  { release_id: 8, creator_id: 2, role_key: "translator" },
  { release_id: 9, creator_id: 2, role_key: "translator" },
  { release_id: 9, creator_id: 3, role_key: "proofreader" },
  { release_id: 9, creator_id: 4, role_key: "image_editor" },
]);

insert("release_tags", [
  { release_id: 5, tag_id: 6, created_at: NOW },
]);

insert("work_external_links", [
  { work_id: 1, label: "作者主页", url: "https://example.com/maou", link_type: "official", created_at: NOW },
  { work_id: 2, label: "VIPRPG Wiki", url: "https://example.com/wiki/monar-castle", link_type: "wiki", created_at: NOW },
]);

insert("release_external_links", [
  { release_id: 9, label: "汉化发布贴", url: "https://example.com/thread/123", link_type: "source", created_at: NOW },
]);

const archives = [
  archive(1, 1, "zip-a", "原版归档", { language: "ja", files: 214, size: 38_000_000, current: 1 }),
  archive(2, 2, "zip-a", "汉化初版", { language: "zh-Hans", files: 216, size: 39_000_000, proofread: 1 }),
  archive(3, 2, "zip-b", "汉化修正档", { language: "zh-Hans", files: 216, size: 39_200_000, proofread: 1, imageEdited: 1, current: 1 }),
  archive(4, 3, "zip-a", "原版归档", { language: "ja", files: 1024, size: 310_000_000, current: 1 }),
  archive(5, 4, "zip-a", "原版归档", { language: "ja", files: 156, size: 21_000_000, current: 1 }),
  archive(6, 5, "zip-a", "投稿版归档", { language: "ja", files: 890, size: 480_000_000, current: 1 }),
  archive(7, 6, "zip-a", "原版归档", { language: "ja", files: 178, size: 26_000_000, current: 1 }),
  archive(8, 7, "zip-a", "原版归档", { language: "ja", files: 402, size: 96_000_000, current: 1 }),
  archive(9, 8, "zip-a", "汉化 v1.0 归档", { language: "zh-Hans", files: 402, size: 97_000_000 }),
  archive(10, 9, "zip-a", "汉化 v2.1 归档", { language: "zh-Hans", files: 405, size: 98_000_000, proofread: 1, imageEdited: 1, current: 1 }),
  archive(11, 10, "zip-a", "重打包归档", { language: "ja", files: 233, size: 41_000_000, current: 1 }),
  archive(12, 11, "zip-a", "原版归档", { language: "ja", files: 245, size: 44_000_000, current: 1 }),
];
insert("archive_versions", archives);

function archive(id, releaseId, key, label, options) {
  const manifestSha = createHash("sha256")
    .update(`dev-seed-manifest-${id}`)
    .digest("hex");
  return {
    id,
    release_id: releaseId,
    archive_key: key,
    archive_label: label,
    language: options.language,
    is_proofread: options.proofread ?? 0,
    is_image_edited: options.imageEdited ?? 0,
    manifest_sha256: manifestSha,
    file_policy_version: "v1",
    packer_version: "dev-seed",
    source_type: "browser_folder",
    source_name: `${label}-源目录`,
    source_file_count: options.files,
    source_size_bytes: options.size,
    total_files: options.files,
    total_size_bytes: options.size,
    unique_blob_size_bytes: Math.floor(options.size * 0.6),
    core_pack_count: 2,
    core_pack_size_bytes: Math.floor(options.size * 0.3),
    estimated_r2_get_count: Math.ceil(options.files / 40) + 2,
    is_current: options.current ?? 0,
    uploader_id: 3,
    status: "published",
    created_at: NOW,
    published_at: NOW,
  };
}

insert("import_jobs", [
  {
    id: 1,
    work_id: 1,
    release_id: 2,
    archive_version_id: 3,
    uploader_id: 3,
    status: "committed",
    source_name: "魔王的暑假-汉化修正",
    source_size_bytes: 39_200_000,
    file_count: 216,
    uploaded_blob_count: 58,
    uploaded_blob_size_bytes: 12_000_000,
    uploaded_core_pack_count: 1,
    uploaded_core_pack_size_bytes: 8_000_000,
    preflight_duration_ms: 4200,
    upload_duration_ms: 65_000,
    commit_duration_ms: 1800,
    created_at: "2026-06-28 08:00:00",
    updated_at: "2026-06-28 08:12:00",
    completed_at: "2026-06-28 08:12:00",
  },
  {
    id: 2,
    uploader_id: 3,
    status: "failed",
    source_name: "损坏的测试目录",
    source_size_bytes: 12_000_000,
    file_count: 88,
    failed_stage: "preflight",
    error_message: "manifest 校验失败：存在重复路径 Data/Map0001.lmu",
    preflight_duration_ms: 900,
    created_at: "2026-06-25 22:00:00",
    updated_at: "2026-06-25 22:01:00",
  },
  {
    id: 3,
    uploader_id: 3,
    status: "uploading",
    source_name: "四天王的日常-补充截图",
    source_size_bytes: 5_000_000,
    file_count: 12,
    missing_blob_count: 4,
    missing_blob_size_bytes: 2_000_000,
    preflight_duration_ms: 600,
    created_at: "2026-06-30 10:00:00",
    updated_at: "2026-06-30 10:05:00",
  },
]);

insert("download_builds", [
  {
    archive_version_id: 3,
    manifest_sha256: createHash("sha256").update("dev-seed-manifest-3").digest("hex"),
    status: "ready",
    size_bytes: 39_200_000,
    download_count: 42,
    cache_hit_count: 30,
    cache_miss_count: 12,
    created_at: "2026-06-28 09:00:00",
    last_accessed_at: "2026-07-01 08:00:00",
  },
  {
    archive_version_id: 4,
    manifest_sha256: createHash("sha256").update("dev-seed-manifest-4").digest("hex"),
    status: "failed",
    failure_count: 2,
    last_error_message: "R2 GET 超时（测试数据）",
    created_at: "2026-06-29 14:00:00",
  },
]);

insert("inbox_items", [
  {
    id: 1,
    type: "role_change_request",
    status: "open",
    sender_user_id: 4,
    audience_min_role_key: "admin",
    target_user_id: 4,
    requested_role_key: "uploader",
    title: "上传权限申请",
    body: "想帮忙补档几个夏之阵的作品，申请上传者权限。",
    created_at: "2026-06-29 12:00:00",
  },
  {
    id: 2,
    type: "system_notice",
    status: "open",
    recipient_user_id: 3,
    title: "导入任务失败提醒",
    body: "你的导入任务 #2 在 preflight 阶段失败，请检查目录后重试。",
    created_at: "2026-06-25 22:02:00",
  },
]);

// ---- 执行 ----------------------------------------------------------------

writeFileSync(seedSqlPath, `${sql.join("\n")}\n`);

run("npx", [
  "wrangler",
  "d1",
  "execute",
  databaseName,
  "--local",
  "--file",
  seedSqlPath,
]);

for (const image of images) {
  const imagePath = join(tmpDir, `dev-seed-${image.name}.png`);
  writeFileSync(imagePath, image.png);
  run("npx", [
    "wrangler",
    "r2",
    "object",
    "put",
    `${bucketName}/${blobR2Key(image.sha256)}`,
    "--local",
    "--file",
    imagePath,
    "--content-type",
    "image/png",
  ]);
}

console.log("");
console.log("本地测试数据已写入。测试账号（密码均为 dev1234567）：");
console.log("  super@dev.local     super_admin");
console.log("  admin@dev.local     admin");
console.log("  uploader@dev.local  uploader");
console.log("  user@dev.local      user");

function run(command, args) {
  const result = spawnSync(command, args, {
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
