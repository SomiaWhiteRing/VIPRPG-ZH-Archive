import { createServer } from "node:http";
import { createReadStream, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { preprocessCSS, resolveConfig } from "vite";
import { buildLibrary, collectionDirectory, readInput, reviewDirectory, root, saveJson } from "./build-character-material-library.mjs";

const stylesheet = resolve(root, "tools/character-material-review/index.css");
const { code: styles } = await preprocessCSS(
  readFileSync(stylesheet, "utf8"),
  stylesheet,
  await resolveConfig({ configFile: false, root }, "serve"),
);

const { items, scopes, characters, decisions } = readInput();
const pending = items.filter((x) => ["collective_scope", "multiple_candidates", "conflicting_anchors"].includes(x.status));
const byId = new Map(pending.map((x) => [x.id, x]));
const knownNames = new Set(characters.map((c) => c.originalName));
const assets = new Map();
for (const item of items) if (/^assets\/[a-f0-9]{64}\.(png|gif|jpg|bmp)$/.test(item.file)) assets.set(item.file, resolve(collectionDirectory, item.file));
for (const scope of scopes) for (const face of scope.faces) {
  assets.set(`faces/${face.sha256}.png`, resolve(root, `data/character-face-sheets/assets/${face.sha256}.png`));
}
const port = 4319;
const origin = `http://127.0.0.1:${port}`;
const json = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) return json(res, 403, { error: "Invalid host" });
    const url = new URL(req.url, origin);
    if (req.method === "GET" && url.pathname === "/styles.css") {
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(styles);
    }
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(readFileSync(resolve(root, "tools/character-material-review/index.html")));
    }
    if (req.method === "GET" && url.pathname === "/data") return json(res, 200, { items: pending, scopes, characters, decisions });
    if (req.method === "GET" && url.pathname.startsWith("/image/")) {
      const key = decodeURIComponent(url.pathname.slice(7));
      if (!assets.has(key)) return json(res, 404, { error: "Unknown image" });
      res.writeHead(200, { "Content-Type": { png: "image/png", gif: "image/gif", jpg: "image/jpeg", bmp: "image/bmp" }[key.split(".").at(-1)], "X-Content-Type-Options": "nosniff" });
      const stream = createReadStream(assets.get(key));
      stream.on("error", () => res.destroy());
      return stream.pipe(res);
    }
    if (req.method !== "POST" || req.headers.origin !== origin || req.headers["content-type"] !== "application/json") return json(res, 403, { error: "Invalid request" });
    if (url.pathname === "/build") return json(res, 200, buildLibrary());
    if (url.pathname !== "/decisions") return json(res, 404, { error: "Unknown route" });
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) return json(res, 413, { error: "Request too large" }); }
    const { ids, action, names } = JSON.parse(raw);
    if (!Array.isArray(ids) || !ids.length || ids.some((id) => !byId.has(id)) || !["assign", "reject", "skip", "reset"].includes(action)) return json(res, 400, { error: "Invalid decision" });
    if (action === "assign" && (!Array.isArray(names) || !names.length || names.some((n) => !knownNames.has(n)))) return json(res, 400, { error: "请选择已有角色" });
    const next = { ...decisions };
    for (const id of ids) {
      if (action === "reset") delete next[id];
      else next[id] = { action, names: action === "assign" ? [...new Set(names)] : [], updatedAt: new Date().toISOString() };
    }
    saveJson(resolve(reviewDirectory, "decisions.json"), next);
    for (const key of Object.keys(decisions)) delete decisions[key];
    Object.assign(decisions, next);
    return json(res, 200, { ok: true, decisions });
  } catch (error) { json(res, 500, { error: error.message }); }
}).listen(port, "127.0.0.1", () => console.log(`角色素材临时审核台 ${origin} — ${pending.length} 项；保存位置 ${reviewDirectory}`));
