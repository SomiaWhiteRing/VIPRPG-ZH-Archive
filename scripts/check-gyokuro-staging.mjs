import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { gyokuroWorkTitle } from "../lib/netplay/gyokuro-web-play.ts";
import { chromium } from "playwright";
import { readConfig, selectDeployment, validateDeployment } from "./deployment-config.mjs";

const origin = "https://staging.viprpg.org";
const configuration = validateDeployment(selectDeployment(readConfig(), "staging"), "staging");
const database = configuration.d1_databases.find(({ binding }) => binding === "DB").database_id;
const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
assert.ok(account && token, "Staging D1 credentials are required");

async function query(sql, params = []) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const data = await response.json();
  assert.ok(response.ok && data.success, "Staging fixture query failed: " + response.status);
  return data.result[0].results;
}

const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL || "chrome",
  args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
});
async function signIn(context, accountKey) {
  const session = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(session).digest("hex");
  await query("INSERT INTO user_sessions (user_id, session_hash, expires_at) SELECT id, ?, datetime('now', '+10 minutes') FROM users WHERE external_auth_id=?", [hash, accountKey]);
  await context.addCookies([{ name: "viprpg_session", value: session, url: origin, httpOnly: true, secure: true }]);
  return () => query("UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_hash=?", [hash]);
}

async function importWork() {
  const getWork = async () => (await query("SELECT id FROM works WHERE original_title=? AND status='published' AND audience='public' ORDER BY id LIMIT 1", [gyokuroWorkTitle]))[0];
  const existing = await getWork();
  if (existing) return existing.id;

  const publisher = "gyokuro-staging:publisher";
  await query("INSERT OR IGNORE INTO users (external_auth_id, display_name) VALUES (?, '玉露弹联机维护')", [publisher]);
  await query("INSERT OR IGNORE INTO user_roles(user_id, role_id) SELECT u.id, r.id FROM users u CROSS JOIN roles r WHERE u.external_auth_id=? AND r.key='uploader'", [publisher]);
  const context = await browser.newContext();
  const revoke = await signIn(context, publisher);
  try {
    const page = await context.newPage();
    await page.goto(origin + "/upload");
    const archive = "data/staging-fixtures/gyokuro-netplay.zip";
    await page.locator('input[type="file"][accept*=".zip"]').setInputFiles(archive);
    await page.locator('[data-upload-phase="awaiting_metadata"]').waitFor({ timeout: 240_000 });
    await page.locator("#upload-original-title").fill(gyokuroWorkTitle);
    await page.locator("#upload-chinese-title").fill("玉露弹（联机版）");
    await page.locator("#upload-release-date").click();
    await page.getByText(String(new Date().getFullYear()), { exact: true }).click();
    await page.locator("#upload-release-date").press("Escape");
    const cover = page.locator('input[type="file"][accept="image/*"][required]');
    if (await cover.count()) {
      const files = unzipSync(await readFile(archive));
      await cover.setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: Buffer.from(files["Title/Title1.png"]) });
      await page.getByRole("button", { name: "选择封面", exact: true }).click();
      await page.getByRole("button", { name: "使用此封面", exact: true }).click();
      await page.getByRole("dialog", { name: "设置封面" }).waitFor({ state: "hidden" });
    }
    const form = page.locator('[data-upload-phase] form');
    const invalid = await form.locator(":invalid").evaluateAll((elements) => elements.map((element) => element.id));
    assert.deepEqual(invalid, [], "Archive upload metadata");
    const commit = page.waitForResponse((response) =>
      response.request().method() === "POST" && /\/api\/imports\/\d+\/commit$/.test(response.url()), { timeout: 120_000 });
    await form.locator('button[type="submit"]').click();
    assert.equal((await commit).status(), 200);
    const created = await getWork();
    assert.ok(created, "Uploaded work is published for anonymous visitors");
    console.log("Imported Gyokuro through the normal staging archive upload, work " + created.id);
    return created.id;
  } finally {
    await context.close();
    await revoke();
  }
}

async function tap(page, key) {
  await gameCanvas(page).focus();
  await page.keyboard.down(key);
  await page.waitForTimeout(90);
  await page.keyboard.up(key);
  await page.waitForTimeout(100);
}

function gameCanvas(page) {
  return page.frameLocator('iframe[title$="游戏画面"]').locator("canvas");
}

async function start(page, path, probe) {
  page.on("websocket", (socket) => {
    if (!socket.url().endsWith("/api/netplay/244/lobby")) return;
    socket.on("framesent", ({ payload }) => probe(">" + payload.toString()));
    socket.on("framereceived", ({ payload }) => probe("<" + payload.toString()));
  });
  await page.goto(origin + path);
  await page.locator('[data-web-play-action="install"]').click({ timeout: 45_000 });
  await page.locator('[data-web-play-action="start"]').click({ timeout: 180_000 });
  const canvas = gameCanvas(page);
  await canvas.waitFor({ timeout: 90_000 });
  await canvas.focus();
}

async function waitUntil(predicate, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(predicate(), label);
}
const fixture = "gyokuro-test:" + randomUUID();
let retireIdentity = false;
try {
  const workId = await importWork();
  const path = "/play/" + workId;
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const packets = [[], []];
  await Promise.all(pages.map((page, index) => start(page, path, (message) => packets[index].push(message))));
  const latest = (side) => {
    const message = packets[side].findLast((packet) => packet.startsWith("<{"));
    return message ? JSON.parse(message.slice(1)) : undefined;
  };
  await waitUntil(() => packets.every((set) => set.includes(">K")), "Both engines entered the in-game lobby");
  await waitUntil(() => [0, 1].every((side) => latest(side)?.self?.name.startsWith("访客 ")), "Anonymous identities in game");
  await tap(pages[0], "ArrowDown");
  await tap(pages[0], "z");
  await waitUntil(() => latest(0)?.roomId && latest(1)?.rooms.some((room) => room.id === latest(0).roomId), "Game lobby room appeared on peer");
  const row = latest(1).rooms.findIndex((room) => room.id === latest(0).roomId);
  for (let i = 0; i < row + 2; ++i) await tap(pages[1], "ArrowDown");
  await tap(pages[1], "z");
  await waitUntil(() => latest(1)?.roomId === latest(0)?.roomId, "Peer joined in game");
  await Promise.all(pages.map(async (page) => {
    await tap(page, "ArrowUp");
    await tap(page, "z");
  }));
  await waitUntil(() => packets.every((set) => set.some((packet) => packet.startsWith("<S "))), "Both ready for the same match");
  await Promise.all(pages.map(async (page) => {
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("z");
    await page.waitForTimeout(2500);
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("z");
  }));
  const checksum = (set) => new Map(set.flatMap((p) => {
    const value = /^>C \d+ (\d+) (\d+)$/.exec(p);
    return value ? [[Number(value[1]), value[2]]] : [];
  }));
  await waitUntil(() => packets.every((set) => checksum(set).has(179)), "Both game engines confirmed frame 179");
  const [first, second] = packets.map(checksum);
  for (const [frame, sum] of first) if (second.has(frame)) assert.equal(sum, second.get(frame), "Frame " + frame);
  assert.ok(packets.every((set) => set.some((p) => p.startsWith(">I ") && (Number(p.split(" ").at(-1)) & 16))), "Both browsers attacked in the game");
  await tap(pages[0], "Escape");
  await waitUntil(() => !latest(0)?.roomId && !latest(1)?.roomId, "Both left the match");
  await Promise.all(contexts.map((context) => context.close()));
  console.log("Verified ordinary staging work " + workId + " installation, in-game rooms and two anonymous fighters.");

  const [asset] = await query("SELECT u.avatar_blob_sha256 AS avatar FROM users u JOIN blobs b ON b.sha256=u.avatar_blob_sha256 WHERE b.status='active' LIMIT 1");
  const avatar = asset?.avatar ?? null;
  const displayName = "联机验证 " + fixture.slice(-8);
  await query("INSERT INTO users (external_auth_id, display_name, avatar_blob_sha256) VALUES (?, ?, ?)", [fixture, displayName, avatar]);
  retireIdentity = true;
  const signed = await browser.newContext();
  const revoke = await signIn(signed, fixture);
  const page = await signed.newPage();
  const seen = [];
  const expectedAvatar = avatar ? "/api/media/blobs/" + avatar : "/icon/alex.png";
  let drawnAvatar = false;
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === expectedAvatar && response.ok()) drawnAvatar = true;
  });
  await start(page, path, (message) => seen.push(message));
  await waitUntil(() => seen.includes(">K"), "Signed-in engine entered the in-game lobby");
  await waitUntil(() => seen.some((message) => message.startsWith("<{") &&
    JSON.parse(message.slice(1)).self?.name === displayName &&
    JSON.parse(message.slice(1)).self?.avatar === expectedAvatar), "Signed-in profile arrived in the game Worker");
  await waitUntil(() => drawnAvatar, "Engine fetched the profile avatar for the in-game lobby");
  await signed.close();
  await revoke();
  console.log("Verified authenticated name and avatar in the in-game staging lobby.");
} finally {
  await browser.close();
  if (retireIdentity) {
    await query("UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE user_id=(SELECT id FROM users WHERE external_auth_id=?)", [fixture]);
    await query("UPDATE users SET status='deleted', display_name='账户已注销', avatar_blob_sha256=NULL WHERE external_auth_id=?", [fixture]);
  }
}
