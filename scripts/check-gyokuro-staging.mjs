import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { readConfig, selectDeployment, validateDeployment } from "./deployment-config.mjs";

const origin = "https://staging.viprpg.org";
const path = "/play/244/netplay";
const timeout = 90_000;
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
const fixture = "gyokuro-test:" + randomUUID();
const fixtureMatch = `external_auth_id GLOB 'gyokuro-test:*' AND email IS NULL AND
  display_name='联机验证 ' || substr(external_auth_id, -8) AND status='active'`;
async function retireFixtures() {
  await query(`UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP
    WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE ${fixtureMatch})`);
  await query(`UPDATE users SET status='deleted', display_name='账户已注销',
    avatar_blob_sha256=NULL, updated_at=CURRENT_TIMESTAMP WHERE ${fixtureMatch}`);
  const [remaining] = await query(`SELECT count(*) AS count FROM users WHERE ${fixtureMatch}`);
  assert.equal(remaining.count, 0, "Temporary staging identities were retired");
}

try {
  await retireFixtures();
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const checksums = pages.map(() => new Map());
  const inputs = pages.map(() => new Set());
  pages.forEach((page, index) => page.on("websocket", (socket) => {
    if (!socket.url().endsWith("/api/netplay/244/lobby")) return;
    socket.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      const check = /^C \d+ (\d+) (\d+)$/.exec(payload);
      if (check) checksums[index].set(Number(check[1]), check[2]);
      const input = /^I \d+ \d+ (\d+)$/.exec(payload);
      if (input) inputs[index].add(Number(input[1]));
    });
  }));
  await Promise.all(pages.map((page) => page.goto(origin + path)));
  for (const page of pages) await page.locator("#identity").getByText(/^访客 /).waitFor();
  const [host, guest] = pages;
  await host.getByRole("button", { name: "创建房间" }).click();
  await host.locator("#room").waitFor();
  const roomId = /房间 (\d{6})/.exec(await host.locator("#status").textContent())?.[1];
  assert.ok(roomId);
  await guest.getByRole("button", { name: "加入 " + roomId }).click();
  await Promise.all(pages.map((page) => page.locator("#players li").nth(1).waitFor()));
  if (await host.locator("#rooms li").count() === 1) {
    await host.getByRole("button", { name: "离开房间" }).click();
    await Promise.all(pages.map((page) => page.locator("#room").waitFor({ state: "hidden" })));
    await Promise.all(pages.map((page) => page.getByRole("button", { name: "自动匹配" }).click()));
    await Promise.all(pages.map((page) => page.locator("#players li").nth(1).waitFor()));
  }
  await guest.locator("#fighter").selectOption("2");
  await Promise.all(pages.map((page) => page.getByRole("button", { name: "准备", exact: true }).click()));
  await Promise.all(pages.map((page) => page.locator("#canvas").waitFor({ timeout })));

  await Promise.all(pages.map((page) => page.keyboard.down("ArrowRight")));
  await Promise.all(pages.map((page) => page.keyboard.down("z")));
  await host.waitForTimeout(2000);
  await Promise.all(pages.flatMap((page) => [page.keyboard.up("ArrowRight"), page.keyboard.up("z")]));
  const deadline = Date.now() + 20_000;
  let synchronized = [];
  while (Date.now() < deadline) {
    synchronized = [...checksums[0]].filter(([frame]) => checksums[1].has(frame));
    if (synchronized.some(([frame]) => frame >= 179) && inputs.every((keys) => [...keys].some((mask) => mask & 16))) break;
    await host.waitForTimeout(250);
  }
  assert.ok(synchronized.some(([frame]) => frame >= 179), "Two live fighters did not confirm enough frames");
  for (const [frame, checksum] of synchronized) assert.equal(checksum, checksums[1].get(frame), "Checksum at frame " + frame);
  assert.ok(inputs.every((keys) => [...keys].some((mask) => mask & 16)), "Both players must send attack input");
  await host.getByRole("button", { name: "离开对战" }).click();
  await Promise.all(pages.map((page) => page.locator("#lobby").waitFor()));
  await Promise.all(contexts.map((context) => context.close()));
  console.log("Staging anonymous match passed: room listing, join, automatic matching, battle inputs and matching frame checksums.");

  const [asset] = await query(
    "SELECT u.avatar_blob_sha256 AS avatar FROM users u JOIN blobs b ON b.sha256=u.avatar_blob_sha256 WHERE b.status='active' LIMIT 1",
  );
  const avatar = asset?.avatar ?? null;
  const displayName = "联机验证 " + fixture.slice(-8);
  const session = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(session).digest("hex");
  await query("INSERT INTO users (external_auth_id, display_name, avatar_blob_sha256) VALUES (?, ?, ?)", [fixture, displayName, avatar]);
  await query("INSERT INTO user_sessions (user_id, session_hash, expires_at) SELECT id, ?, datetime('now', '+10 minutes') FROM users WHERE external_auth_id=?", [hash, fixture]);

  const signed = await browser.newContext();
  await signed.addCookies([{ name: "viprpg_session", value: session, url: origin, httpOnly: true, secure: true }]);
  const signedPage = await signed.newPage();
  await signedPage.goto(origin + path);
  await signedPage.locator("#identity").getByText(displayName, { exact: true }).waitFor();
  const expected = avatar ? "/api/media/blobs/" + avatar : "/icon/alex.png";
  assert.equal(await signedPage.locator("#identity img").getAttribute("src"), expected);
  await signedPage.waitForFunction(() => document.querySelector("#identity img")?.naturalWidth > 0);
  await signedPage.getByRole("button", { name: "创建房间" }).click();
  await signedPage.locator("#players").getByText(displayName, { exact: true }).waitFor();
  assert.equal(await signedPage.locator("#players img").getAttribute("src"), expected);
  console.log(avatar ? "Authenticated name and saved avatar loaded in staging." : "Authenticated name and site default avatar loaded in staging.");
} finally {
  await browser.close();
  await retireFixtures();
}
