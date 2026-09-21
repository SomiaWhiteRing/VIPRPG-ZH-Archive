import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { output: { type: "string" } } });
const output = resolve(root, values.output ?? `output/staging-seed/${new Date().toISOString().replace(/[:.]/g, "-")}`);
if (!output.startsWith(resolve(root, "output") + sep)) throw new Error("Seed output must stay inside output/.");
if (existsSync(resolve(output, "manifest.json"))) throw new Error("Choose a new output directory; a prepared seed already exists here.");
mkdirSync(output, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const literal = (value) => value === null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const sourceManifest = JSON.parse(readFileSync(resolve(root, "data/local-seed/manifest.json"), "utf8"));
if (sourceManifest.schema !== "viprpg-local-seed.v1") throw new Error("Unknown local seed format.");
const sourceCompressed = readFileSync(resolve(root, sourceManifest.database.file));
const sourceBytes = gunzipSync(sourceCompressed);
if (hash(sourceCompressed) !== sourceManifest.database.gzipSha256 || hash(sourceBytes) !== sourceManifest.database.sha256) throw new Error("Source seed checksum mismatch.");
const sourcePath = resolve(output, "source.sqlite");
writeFileSync(sourcePath, sourceBytes);
const source = new DatabaseSync(sourcePath, { readOnly: true });
const selected = new DatabaseSync(":memory:");
const schema = readFileSync(resolve(root, "migrations/0001_init_archive_schema.sql"), "utf8");
selected.exec(schema);

try {
  const approvedSheets = source.prepare("SELECT * FROM face_sheets WHERE library_status='approved' ORDER BY id").all();
  const approvedIds = new Set(approvedSheets.map((row) => row.id));
  const resources = source.prepare("SELECT * FROM resources WHERE visibility='published' ORDER BY sort_order,id").all();
  const materials = source.prepare("SELECT * FROM character_materials ORDER BY id").all();
  const defaultEmojis = source.prepare("SELECT * FROM default_face_emojis ORDER BY position").all();
  const emojiIds = new Set(defaultEmojis.map((row) => row.emoji_id));
  const emojiRefs = source.prepare("SELECT * FROM available_face_emojis ORDER BY id").all().filter((row) => emojiIds.has(row.id));
  if (emojiRefs.length !== defaultEmojis.length) throw new Error("A default emoji is not approved or its blob is unavailable.");
  const blobShas = new Set([
    ...[...approvedSheets, ...materials, ...emojiRefs].map((row) => row.blob_sha256),
    ...resources.map((row) => row.icon_blob_sha256),
  ]);
  const blobs = source.prepare("SELECT * FROM blobs ORDER BY sha256").all().filter((row) => blobShas.has(row.sha256));
  if (blobs.length !== blobShas.size || blobs.some((row) => row.status !== "active")) throw new Error("Selected materials or resource icons reference missing or inactive blobs.");
  const portraits = source.prepare("SELECT * FROM character_portrait_refs ORDER BY id").all().filter((row) => approvedIds.has(row.face_sheet_id));
  const portraitIds = new Set(portraits.map((row) => row.id));
  const defaultPortraits = source.prepare("SELECT * FROM character_default_portraits ORDER BY character_id").all();
  if (defaultPortraits.some((row) => !portraitIds.has(row.portrait_ref_id))) throw new Error("A default portrait is outside the approved face library.");
  const categories = source.prepare(`WITH RECURSIVE hierarchy(id,depth) AS (
    SELECT id,0 FROM character_categories WHERE parent_id IS NULL
    UNION ALL SELECT c.id,h.depth+1 FROM character_categories c JOIN hierarchy h ON c.parent_id=h.id
  ) SELECT c.* FROM hierarchy h JOIN character_categories c ON c.id=h.id ORDER BY h.depth,c.id`).all();
  if (categories.length !== source.prepare("SELECT count(*) n FROM character_categories").get().n) throw new Error("Category hierarchy is incomplete.");
  const rowsByTable = new Map([
    ["blobs", blobs.map((row) => ({ ...row, first_seen_archive_version_id: null }))],
    ["characters", source.prepare("SELECT * FROM characters ORDER BY id").all()],
    ["character_aliases", source.prepare("SELECT * FROM character_aliases ORDER BY id").all()],
    ["character_categories", categories],
    ["character_category_memberships", source.prepare("SELECT * FROM character_category_memberships ORDER BY category_id,character_id").all()],
    ["character_sources", source.prepare("SELECT * FROM character_sources ORDER BY character_id,url").all()],
    ["face_sheets", approvedSheets.map((row) => ({ ...row, created_by_user_id: null }))],
    ["character_face_sheet_bindings", source.prepare("SELECT * FROM character_face_sheet_bindings ORDER BY character_id,face_sheet_id").all().filter((row) => approvedIds.has(row.face_sheet_id))],
    ["character_portrait_refs", portraits.map((row) => ({ ...row, created_by_user_id: null }))],
    ["character_default_portraits", defaultPortraits],
    ["character_materials", materials],
    ["character_material_bindings", source.prepare("SELECT * FROM character_material_bindings ORDER BY character_id,material_id").all()],
    ["face_emoji_refs", emojiRefs],
    ["default_face_emojis", defaultEmojis],
    ["resources", resources.map((row) => ({ ...row, last_release_sequence: 0 }))],
  ]);
  const statements = [];
  selected.exec("BEGIN");
  for (const [table, rows] of rowsByTable) {
    if (!rows.length) continue;
    const columns = selected.prepare(`PRAGMA table_info(${quote(table)})`).all().map((row) => row.name);
    const insert = selected.prepare(`INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
    // Bound SQL size and row count to stay within D1's parser memory limit.
    const prefix = `INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES `;
    let tuples = [], size = Buffer.byteLength(prefix);
    for (const row of rows) {
      const cells = columns.map((column) => row[column]);
      if (cells.some((value) => value === undefined)) throw new Error(`Source schema differs for ${table}.`);
      insert.run(...cells);
      const tuple = `(${cells.map(literal).join(",")})`;
      const bytes = Buffer.byteLength(tuple) + 2;
      if (bytes + Buffer.byteLength(prefix) > 90000) throw new Error(`Oversized seed row in ${table}.`);
      if (size + bytes > 90000 || tuples.length >= 100) { statements.push(`${prefix}${tuples.join(",\n")};`); tuples = []; size = Buffer.byteLength(prefix); }
      tuples.push(tuple); size += bytes;
    }
    if (tuples.length) statements.push(`${prefix}${tuples.join(",\n")};`);
  }
  selected.exec("COMMIT");
  const violations = selected.prepare("PRAGMA foreign_key_check").all();
  if (violations.length) throw new Error(`Seed foreign key violations: ${JSON.stringify(violations)}`);
  if (selected.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Seed integrity check failed.");
  const populated = {};
  for (const { name } of selected.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'forum_search_index%' ORDER BY name").all()) {
    const count = selected.prepare(`SELECT count(*) n FROM ${quote(name)}`).get().n;
    if (count && !rowsByTable.has(name) && !["roles", "role_permissions"].includes(name)) throw new Error(`Unexpected data in ${name}.`);
    populated[name] = count;
  }
  const sourceObjects = new Map(sourceManifest.objects.map((item) => [item.key, item]));
  const objects = [];
  for (const blob of blobs) {
    const sha = blob.sha256;
    const key = `blobs/sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;
    const item = sourceObjects.get(key);
    if (!item || item.sha256 !== sha || item.size !== blob.size_bytes) throw new Error(`Missing blob object: ${sha}`);
    const path = resolve(root, item.file);
    if (!path.startsWith(root + sep)) throw new Error("Object outside repository.");
    const bytes = readFileSync(path);
    if (bytes.length !== item.size || hash(bytes) !== sha) throw new Error(`Blob checksum mismatch: ${item.file}`);
    objects.push(item);
  }
  const sql = `${statements.join("\n")}\n`;
  writeFileSync(resolve(output, "data.sql"), sql);
  writeFileSync(resolve(output, "statements.json"), JSON.stringify(statements) + "\n");
  writeFileSync(resolve(output, "manifest.json"), JSON.stringify({
    schema: "viprpg-staging-seed.v1", preparedAt: new Date().toISOString(),
    sourceDatabaseSha256: sourceManifest.database.sha256, schemaSha256: hash(schema),
    sqlSha256: hash(sql), tables: populated, objects,
    validation: { foreignKeyViolations: 0, integrity: "ok", users: 0, works: 0 },
  }, null, 2) + "\n");
  console.log(JSON.stringify({ output: relative(root, output), characters: populated.characters, categories: populated.character_categories,
    defaultPortraits: populated.character_default_portraits, defaultEmojis: populated.default_face_emojis, resources: populated.resources,
    objects: objects.length, bytes: objects.reduce((sum, item) => sum + item.size, 0), sqlStatements: statements.length, users: 0, works: 0 }));
} finally { source.close(); selected.close(); }
