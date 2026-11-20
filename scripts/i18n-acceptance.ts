import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page, type Request as BrowserRequest } from "playwright";
import routes from "../app/routes";
import { translate } from "../lib/i18n/core";
import { zh } from "../lib/i18n/messages/zh-Hans";
import { UI_LOCALES, type UiLocale } from "../lib/i18n/locale";
import { getPageSearchScope, searchScopeLabel } from "../lib/search";
import { AcceptanceTui, type AcceptanceCase } from "./i18n-acceptance-tui";
import { freePort, LocalAcceptanceSite, LOCAL_PASSWORD, ORIGINAL_CONTENT } from "./i18n-acceptance-local";

const { values: options } = parseArgs({ options: {
  url: { type: "string" }, fixtures: { type: "string" }, "storage-state": { type: "string" },
  output: { type: "string" }, filter: { type: "string" }, plan: { type: "boolean" },
  plain: { type: "boolean" }, hold: { type: "boolean" }, help: { type: "boolean" },
  suite: { type: "string", default: "all" },
  "retry-report": { type: "string" }, game: { type: "string" },
} });
if (options.help) {
  console.log("node --import tsx scripts/i18n-acceptance.ts [--suite all|header] [--retry-report report.json] [--game output/easyrpg/testgame.zip] [--hold] [--url http://127.0.0.1:PORT] [--fixtures file.json] [--storage-state state.json] [--filter path] [--output directory] [--plan] [--plain]");
  console.log("默认构建当前源码并创建隔离本地测试环境。--url 使用已有本地站点。P 暂停，F 筛选问题，↑↓ 详情，Q 停止；--hold 完成后保留 TUI。");
  process.exit(0);
}
if (options.suite !== "all" && options.suite !== "header") throw new Error("--suite 仅支持 all 或 header");
if (options.url && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(options.url).hostname))
  throw new Error("该验收程序包含登录和草稿操作，请指定本地测试站点。");
const directory = resolve(options.output || join("output/i18n-browser", new Date().toISOString().replace(/[:.]/g, "-")));
mkdirSync(directory, { recursive: true });
const locales = Object.keys(UI_LOCALES) as UiLocale[];
const viewports: Record<string, { width: number; height: number }> = options.suite === "header"
  ? Object.fromEntries([320, 360, 390, 414, 480, 640, 768, 1024, 1440].map(width => [String(width), { width, height: 900 }]))
  : { desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } };
type RouteEntry = { path?: string; file: string; index?: boolean; children?: RouteEntry[] };
type Target = { pattern: string; file: string; path?: string; blocked?: string; persona: AcceptanceCase["persona"]; redirect?: boolean };
const fixturePaths: Record<string, string> = options.fixtures ? JSON.parse(readFileSync(options.fixtures, "utf8")) : {};
const localFixtures = !options.url;
const targets: Target[] = [];
let layoutCount = 0;
function collect(entries: RouteEntry[], parent = "") {
  for (const entry of entries) {
    const pattern = "/" + [parent, entry.path === "*" ? "__i18n_missing__" : entry.path || ""].filter(Boolean).join("/").replace(/^\//, "");
    if (entry.children) { layoutCount++; collect(entry.children, pattern.slice(1)); continue; }
    let path = fixturePaths[entry.file];
    let persona: Target["persona"] = pattern.startsWith("/admin") || pattern.endsWith("/edit") || pattern.endsWith("/relations") ? "admin" :
      pattern.startsWith("/me") || pattern.startsWith("/inbox") || pattern.startsWith("/history/") || pattern === "/upload" ? "member" : "guest";
    if (!path && !pattern.includes(":")) path = pattern;
    if (!path && localFixtures) {
      path = pattern.replace(":kind", "work").replace(/:userId/g, pattern.startsWith("/me/messages/") ? "1" : "2")
        .replace(/:matchId/g, "i18n-match").replace(/:id/g, pattern.startsWith("/admin/resources/") ? "i18n-resource" : "1")
        .replace(/:(workId|creatorId|characterId|topicId|postNumber|itemId|importJobId|archiveVersionId|reportId|commentId)/g, "1");
    }
    if (pattern === "/admin/tags/edit" && localFixtures) path += "?name=" + encodeURIComponent("验收标签");
    if (pattern === "/me/profile/delete") persona = "member";
    targets.push({ pattern, file: entry.file, path,
      persona, blocked: path ? undefined : "缺少该路由的有效实体夹具",
      redirect: entry.file === "games/[id]/collections/page.tsx" || entry.file.startsWith("discussions/search/") ||
        /discussions\/\[topicId\]\/(posts|comments)/.test(entry.file) });
  }
}
collect(routes);
const selectedTargets = options.filter ? targets.filter(t => t.pattern.includes(options.filter!)) : targets;
if (!selectedTargets.length) throw new Error("筛选没有匹配任何路由");
const cases: AcceptanceCase[] = [];
let number = 0;
function add(group: string, name: string, locale: string, viewport: string, persona: AcceptanceCase["persona"], path?: string, reason?: string) {
  const item: AcceptanceCase = { id: String(++number).padStart(4, "0"), group, name, locale, viewport, persona, path, status: "pending", reason };
  cases.push(item);
  return item;
}
const routeCases = new Map<string, Target>();
if (options.suite === "all") for (const target of selectedTargets) for (const locale of locales) for (const viewport of Object.keys(viewports)) {
  const item = add("route", target.pattern, locale, viewport, target.persona, target.path, target.blocked);
  routeCases.set(item.id, target);
}
if (options.suite === "all") for (const viewport of Object.keys(viewports)) {
  for (const from of locales) for (const to of locales) if (from !== to) {
    add("switch", `语言参数 ${from} → ${to}；锚点、原文`, `${from}>${to}`, viewport, "guest", localFixtures ? "/games/1" : "/about");
    add("preference", `账号语言偏好 ${from} → ${to}`, `${from}>${to}`, viewport, "member", "/me/privacy");
  }
  for (const locale of locales) {
    add("automatic", "浏览器语言与 URL 优先级", locale, viewport, "guest", "/about");
    add("preference-auto", "账号语言恢复自动", locale, viewport, "member", "/me/privacy");
    add("navigation", "站内导航与前进后退", locale, viewport, "guest", "/about");
    add("pagination", "作品翻页保留语言", locale, viewport, "guest", "/games");
    add("login", "登录后返回原地址", locale, viewport, "guest", "/login", localFixtures ? undefined : "已有站点模式未提供隔离登录账号");
    add("iframe", "超展开右栏语言", locale, viewport, "guest", "/rakuen", viewport === "mobile" ? "移动布局不显示右栏，此用例不适用" : undefined);
  }
}
if (options.suite === "header") for (const viewport of Object.keys(viewports)) for (const locale of locales) for (const persona of ["guest", "member", "admin"] as const) {
  add("header", `共用页头（${persona}）`, locale, viewport, persona, persona === "admin" ? "/admin" : "/about");
}
if (options["retry-report"]) {
  const previous = JSON.parse(readFileSync(options["retry-report"], "utf8")) as { cases: AcceptanceCase[] };
  const identity = (item: AcceptanceCase) => JSON.stringify([item.group, item.name, item.locale, item.viewport]);
  const requested = new Set(previous.cases.filter(item => item.status === "failed" || item.status === "blocked").map(identity));
  const selected = cases.filter(item => requested.has(identity(item)));
  assert.equal(selected.length, requested.size, "旧报告的问题用例未全部匹配，禁止静默漏跑");
  assert(selected.length > 0, "旧报告没有失败或阻塞用例");
  cases.splice(0, cases.length, ...selected);
}
const report = {
  startedAt: new Date().toISOString(), finishedAt: null as string | null, status: "preparing", target: options.url || "",
  scope: { suite: options.suite, routeFiles: targets.length + layoutCount, leafRoutes: targets.length, layoutsCoveredByChildren: layoutCount, selectedLeafRoutes: options.suite === "header" ? 2 : new Set(cases.filter(item => item.group === "route").map(item => item.name)).size, locales, viewports,
    checks: options.suite === "header"
      ? ["三语页头控件", "访客/用户/管理员身份", "九种屏幕宽度", "菜单展开与关闭", "移动搜索展开", "控件边界及整页横向溢出", "裸露翻译键和占位符", "页面异常"]
      : ["HTML/HTTP/页面异常", "语言与预期控件文案", "裸露翻译键和占位符", "整页横向溢出", "语言参数", "浏览器语言", "账号偏好保存", "导航历史", "分页", "登录返回", "iframe 语言"],
    limitation: "词义和视觉美感需另行评估；缺少实体或登录态的路由记为阻塞。叶路由计数排除布局文件的重复地址。" },
  retryReport: options["retry-report"] || null,
  cases, counts: {} as Record<string, number>, error: null as string | null,
};
async function save() {
  report.counts = Object.fromEntries(["pending", "running", "passed", "failed", "blocked", "skipped"].map(status => [status, cases.filter(item => item.status === status).length]));
  writeFileSync(join(directory, "report.tmp"), JSON.stringify(report, null, 2));
  // Windows readers can briefly prevent replacement even though the directory is writable.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(join(directory, "report.tmp"), join(directory, "report.json"));
      break;
    } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "") || attempt === 5) throw error;
      await delay(100 * 2 ** attempt);
    }
  }
}
await save();
if (options.plan) {
  console.log(JSON.stringify({ ...report.scope, totalCases: cases.length, output: directory }, null, 2));
  process.exit(0);
}
const tui = new AcceptanceTui(cases, directory, options.plain);
let browser: Browser | undefined, site: LocalAcceptanceSite | undefined;
let origin = options.url || "";
let cookies: { admin: string; member: string } | undefined;
const contexts = new Map<string, BrowserContext>();
tui.onCancel = () => { void browser?.close(); void site?.stop(); };
const knownKeys = new Set(Object.keys(zh));
class Blocked extends Error {}
class Skipped extends Error {}
process.once("SIGINT", () => { tui.canceled = true; tui.paused = false; void browser?.close(); void site?.stop(); });

async function contextFor(item: AcceptanceCase) {
  const locale = item.locale.split(">")[0];
  const id = item.persona + ":" + item.viewport + ":" + locale;
  let context = contexts.get(id);
  if (!context) {
    context = await browser!.newContext({ viewport: viewports[item.viewport as keyof typeof viewports], locale, reducedMotion: "reduce",
      storageState: item.persona !== "guest" ? options["storage-state"] : undefined });
    if (cookies && item.persona !== "guest") await context.addCookies([{ name: "viprpg_session", value: cookies[item.persona], url: origin, httpOnly: true, sameSite: "Lax" }]);
    contexts.set(id, context);
  }
  return context;
}
async function languageReady(page: Page, locale: UiLocale) {
  await page.waitForFunction(value => document.documentElement.lang === value, locale, { timeout: 15_000 });
  assert.equal(await page.locator('#site-header select').count(), 0, "页头不应显示语言选择器");
}
async function goto(page: Page, path: string, locale: UiLocale) {
  const url = new URL(path, origin);
  url.searchParams.set("lang", locale);
  const response = await page.goto(url.href, { waitUntil: "load", timeout: 30_000 });
  if (!response) throw new Error("页面没有文档响应");
  if ([401, 403].includes(response.status())) throw new Blocked(`HTTP ${response.status()}：登录态或权限不足`);
  if (response.status() === 404 && path !== "/__i18n_missing__") throw new Blocked("HTTP 404：路由实体夹具不存在");
  if (response.status() >= 400 && path !== "/__i18n_missing__") throw new Error(`HTTP ${response.status()}`);
  if (new URL(page.url()).pathname === "/login" && new URL(path, origin).pathname !== "/login")
    throw new Blocked("目标页面重定向到登录页");
  await languageReady(page, locale);
  if (/^\/discussions\/\d+/.test(url.pathname)) {
    await page.locator("[data-forum-post]").first().waitFor();
    if (localFixtures) await page.getByText("Original forum body 用户原文", { exact: true }).waitFor();
  }
  return response;
}
async function switchLanguage(page: Page, locale: UiLocale) {
  const target = new URL(page.url());
  target.searchParams.set("lang", locale);
  await page.goto(target.href, { waitUntil: "load" });
  await languageReady(page, locale);
  await page.waitForLoadState("load");
}
async function inspectPage(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const findings = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - width;
    const texts: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const element = walker.currentNode.parentElement;
      if (!element || element.closest("script,style,pre,code,textarea,svg,[contenteditable=true]") || !element.getClientRects().length) continue;
      const text = walker.currentNode.textContent?.trim();
      if (text) texts.push(text);
    }
    return { overflow, texts, title: document.title };
  });
  assert(findings.title && !findings.title.includes("undefined"), "文档标题为空或包含 undefined");
  assert(findings.overflow <= 3, `页面横向溢出 ${findings.overflow}px`);
  const leaked = findings.texts.filter(text => knownKeys.has(text) || /^(undefined|NaN)$/.test(text) || /^\{[a-zA-Z][\w]*(?:,\s*(?:plural|select|number)[\s\S]*)?\}$/.test(text));
  assert.equal(leaked.length, 0, "界面出现未格式化内容：" + leaked.slice(0, 5).join(" | "));
}
async function runCase(item: AcceptanceCase, page: Page) {
  if (item.group === "iframe" && item.viewport === "mobile") throw new Skipped(item.reason);
  if (item.reason) throw new Blocked(item.reason);
  const locale = item.locale.split(">")[0] as UiLocale;
  if (item.group === "header") {
    await goto(page, item.path!, locale);
    const verifyHeader = async () => {
      const dimensions = await page.locator("#site-header").evaluate(header => {
        const width = document.documentElement.clientWidth;
        return { width, scrollWidth: document.documentElement.scrollWidth, outside: [...header.querySelectorAll("a,button,select")].flatMap(element => {
          const bounds = element.getBoundingClientRect();
          return bounds.width && bounds.height && (bounds.left < -1 || bounds.right > width + 1)
            ? [{ label: element.getAttribute("aria-label") || element.textContent?.trim(), left: bounds.left, right: bounds.right }] : [];
        }) };
      });
      assert(dimensions.scrollWidth <= dimensions.width + 3, JSON.stringify(dimensions));
      assert.equal(dimensions.outside.length, 0, JSON.stringify(dimensions));
    };
    await verifyHeader();
    const menu = page.getByRole("button", { name: translate(locale, "header.openMenu"), exact: true });
    if (await menu.isVisible()) {
      await menu.click(); await verifyHeader();
      await page.getByRole("button", { name: translate(locale, "header.closeMenu"), exact: true }).click();
    }
    if (item.persona !== "admin") {
      const [scope] = getPageSearchScope("/about", "");
      const search = page.getByRole("button", { name: translate(locale, "header.searchScope", { scope: searchScopeLabel(scope, locale) }), exact: true });
      if (await search.isVisible()) { await search.click(); await verifyHeader(); await page.keyboard.press("Escape"); }
    }
  } else if (item.group === "route") {
    const target = routeCases.get(item.id)!;
    if (item.persona !== "guest" && !cookies && !options["storage-state"]) throw new Blocked("该页面需要登录态，未提供 storage-state");
    const response = await goto(page, item.path!, locale);
    if (item.persona !== "guest" && new URL(page.url()).pathname === "/" && item.path !== "/")
      throw new Blocked("权限检查将测试账号重定向到首页");
    if (!target.redirect) assert.equal(new URL(page.url()).pathname, new URL(item.path!, origin).pathname, "目标页发生未预期重定向");
    if (target.pattern === "/__i18n_missing__") {
      assert.equal(response.status(), 404);
      assert(await page.getByRole("heading", { name: translate(locale, "core.notFound.title") }).count(), "404 文案未本地化");
    }
    if (localFixtures && target.pattern === "/discussions/:topicId/comments/:commentId") {
      await page.locator("#floor-comments-2 #comment-1").getByText("Original nested reply 楼中楼原文", { exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get("floor"), "2", "楼中楼应定位到二楼");
      assert.equal(new URL(page.url()).hash, "#comment-1", "楼中楼应保留评论锚点");
    }
    if (item.viewport === "mobile" && ["/admin", "/admin/permissions"].includes(target.pattern)) {
      const surface = page.locator('[data-slot="table-surface"]').first();
      const scrolled = await surface.evaluate(element => {
        element.scrollLeft = element.scrollWidth;
        const result = { moved: element.scrollLeft > 0, width: element.clientWidth, total: element.scrollWidth };
        element.scrollLeft = 0;
        return result;
      });
      assert(scrolled.total > scrolled.width && scrolled.moved, "宽表格应可在自身容器内横向滚动");
    }
  } else if (item.group === "preference" || item.group === "preference-auto") {
    if (!cookies && !options["storage-state"]) throw new Blocked("账号语言设置需要隔离登录态");
    await goto(page, "/me/privacy", locale);
    const selected = item.group === "preference-auto" ? "auto" : item.locale.split(">")[1] as UiLocale;
    const language = page.getByRole("radiogroup", { name: translate(locale, "account.language.label"), exact: true });
    await language.getByRole("radio", { name: selected === "auto" ? translate(locale, "account.language.auto") : UI_LOCALES[selected], exact: true }).click();
    await page.locator('form[action*="/api/account/privacy"]').locator('button[type="submit"]').click();
    await page.waitForURL(url => url.pathname === "/me/privacy" && url.searchParams.has("settingsUpdated") && !url.searchParams.has("lang"));
    await languageReady(page, selected === "auto" ? locale : selected);
    await page.goto(origin + "/about", { waitUntil: "load" });
    await languageReady(page, selected === "auto" ? locale : selected);
  } else if (item.group === "switch") {
    const to = item.locale.split(">")[1] as UiLocale;
    await goto(page, item.path! + "?audit=keep#i18n-anchor", locale);
    if (localFixtures) assert((await page.locator("body").innerText()).includes(ORIGINAL_CONTENT), "原文夹具缺失");
    await switchLanguage(page, to);
    assert.equal(new URL(page.url()).searchParams.get("audit"), "keep");
    assert.equal(new URL(page.url()).hash, "#i18n-anchor");
    if (localFixtures) assert((await page.locator("body").innerText()).includes(ORIGINAL_CONTENT), "切换语言改变了作品原文");
  } else if (item.group === "automatic") {
    await page.context().addCookies([{ name: "viprpg_ui_locale", value: locales.find(value => value !== locale)!, url: origin }]);
    await page.goto(origin + "/about", { waitUntil: "load" });
    await languageReady(page, locale);
    await goto(page, "/about", locales.find(value => value !== locale)!);
  } else if (item.group === "navigation") {
    await goto(page, "/about", locale);
    const menu = page.getByRole("button", { name: translate(locale, "header.openMenu"), exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("link", { name: translate(locale, "core.nav.games"), exact: true }).filter({ visible: true }).first().click();
    await page.waitForURL(url => url.pathname === "/games");
    assert.equal(new URL(page.url()).searchParams.get("lang"), locale);
    await languageReady(page, locale);
    await page.goBack({ waitUntil: "load" }); await languageReady(page, locale);
    assert.equal(new URL(page.url()).pathname, "/about");
    await page.goForward({ waitUntil: "load" }); await languageReady(page, locale);
    assert.equal(new URL(page.url()).pathname, "/games");
  } else if (item.group === "pagination") {
    await goto(page, "/games", locale);
    const next = page.getByRole("link", { name: translate(locale, "pagination.next"), exact: true });
    if (!await next.count()) throw new Blocked("作品数量不足一页，缺少分页夹具");
    await next.click(); await page.waitForURL(url => url.searchParams.get("page") === "2");
    assert.equal(new URL(page.url()).searchParams.get("lang"), locale); await languageReady(page, locale);
  } else if (item.group === "login") {
    await goto(page, "/login?next=" + encodeURIComponent("/games/1?audit=login#sec-comments"), locale);
    await page.locator('input[name="email"]').fill("i18n-member@example.test");
    await page.locator('input[name="password"]').fill("invalid-acceptance-password");
    const rejected = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
    await page.locator('form[action*="/api/auth/login"]').getByRole("button", { name: translate(locale, "core.login"), exact: true }).click();
    const failure = await rejected;
    assert.equal(failure.status(), 400, "错误密码应按登录接口契约返回 400");
    const error = await failure.json() as { ok: boolean; error: string };
    assert.equal(error.ok, false, "错误密码不得登录成功");
    assert.equal(error.error, translate(locale, "auth.error.credentials"), "错误密码提示应使用当前语言");
    await page.getByText(error.error, { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/login", "登录失败不应跳转");
    assert(!(await page.context().cookies(origin)).some(cookie => cookie.name === "viprpg_session"), "错误密码不得创建会话");
    await page.locator('input[name="password"]').fill(LOCAL_PASSWORD);
    await page.locator('form[action*="/api/auth/login"]').getByRole("button", { name: translate(locale, "core.login"), exact: true }).click();
    await page.waitForURL(url => url.pathname === "/games/1");
    assert.equal(new URL(page.url()).searchParams.get("lang"), locale);
    assert.equal(new URL(page.url()).searchParams.get("audit"), "login");
    assert.equal(new URL(page.url()).hash, "#sec-comments"); await languageReady(page, locale);
    assert((await page.context().cookies(origin)).some(cookie => cookie.name === "viprpg_session"), "登录成功应建立会话");
  } else if (item.group === "iframe") {
    await goto(page, "/rakuen", locale);
    const link = page.locator('a[target="rakuen-content"]').first();
    if (!await link.count()) throw new Blocked("超展开列表没有可打开的内容");
    await link.click();
    const frame = page.frameLocator('iframe[name="rakuen-content"]');
    await frame.locator(`html[lang="${locale}"]`).waitFor({ timeout: 15_000 });
  }
  await inspectPage(page);
}

try {
  if (!options.url) {
    site = new LocalAcceptanceSite(directory, tui, await freePort(), options.game);
    tui.target = site.origin;
    const local = await site.prepare();
    origin = local.origin; cookies = local.tokens;
  }
  report.target = origin; tui.target = origin; tui.phase = "启动 Chromium"; await save();
  browser = await chromium.launch({ headless: true });
  report.status = "running"; tui.phase = "浏览器验收";
  for (const item of cases) {
    await tui.checkpoint();
    item.status = "running"; tui.render(); await save();
    appendFileSync(join(directory, "events.jsonl"), JSON.stringify({ at: new Date().toISOString(), id: item.id, status: item.status }) + "\n");
    const start = Date.now();
    let page: Page | undefined;
    const pageErrors: string[] = [];
    const requests = new Map<BrowserRequest, { url: string; method: string; type: string; started: number; status?: number }>();
    try {
      if (item.reason) { if (item.group === "iframe" && item.viewport === "mobile") throw new Skipped(item.reason); throw new Blocked(item.reason); }
      const context = await contextFor(item);
      if (item.persona === "guest") await context.clearCookies();
      page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.on("request", request => requests.set(request, { url: request.url(), method: request.method(), type: request.resourceType(), started: Date.now() }));
      page.on("response", response => { const entry = requests.get(response.request()); if (entry) entry.status = response.status(); });
      page.on("requestfinished", request => requests.delete(request));
      page.on("requestfailed", request => requests.delete(request));
      page.on("pageerror", error => pageErrors.push(error.message));
      page.on("console", message => {
        if (message.type() === "error") appendFileSync(join(directory, "browser-console.jsonl"), JSON.stringify({ id: item.id, url: page?.url(), message: message.text() }) + "\n");
      });
      await runCase(item, page);
      assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
      item.status = "passed"; item.reason = undefined;
    } catch (error) {
      item.status = error instanceof Blocked ? "blocked" : error instanceof Skipped ? "skipped" : "failed";
      item.reason = error instanceof Error ? error.message : String(error);
      if (page && !page.isClosed()) {
        const screenshot = join(directory, item.id + ".png");
        if (await page.screenshot({ path: screenshot, fullPage: true, timeout: 5000 }).then(() => true, () => false)) item.screenshot = screenshot;
        const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].flatMap(element => {
          const box = element.getBoundingClientRect();
          return box.right > document.documentElement.clientWidth + 3 ? [{ tag: element.tagName, className: element.getAttribute("class"), right: box.right,
            width: element.clientWidth, scrollWidth: element.scrollWidth, overflow: getComputedStyle(element).overflowX }] : [];
        }).slice(0, 30)).catch(() => []);
        writeFileSync(join(directory, item.id + ".json"), JSON.stringify({ url: page.url(), error: item.reason, pageErrors, overflow, pendingRequests: [...requests.values()] }, null, 2));
      }
    } finally {
      if (requests.size) appendFileSync(join(directory, "pending-requests.jsonl"), JSON.stringify({ id: item.id, requests: [...requests.values()] }) + "\n");
      await page?.close().catch(() => {});
      item.durationMs = Date.now() - start; await save();
      tui.log(`${item.id} ${item.status} ${item.name}`);
      appendFileSync(join(directory, "events.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...item }) + "\n");
    }
  }
  report.status = cases.some(item => item.status === "failed" || item.status === "blocked") ? "completed-with-issues" : "passed";
} catch (error) {
  report.status = tui.canceled ? "canceled" : "blocked";
  report.error = error instanceof Error ? error.message : String(error);
  for (const item of cases) if (item.status === "pending" || item.status === "running") {
    item.status = tui.canceled ? "skipped" : "blocked";
    item.reason = report.error;
  }
  tui.log(report.error);
} finally {
  await browser?.close().catch(() => {});
  await site?.stop();
  report.finishedAt = new Date().toISOString(); await save();
  tui.phase = report.status === "passed" ? "全部通过" : report.status === "canceled" ? "已停止" : "已完成，存在失败或阻塞";
  tui.log(`报告已保存：${join(directory, "report.json")}`);
  await tui.finish(Boolean(options.hold));
  console.log(JSON.stringify({ status: report.status, counts: report.counts, report: join(directory, "report.json") }, null, 2));
  process.exitCode = report.status === "passed" ? 0 : report.status === "canceled" ? 130 : 1;
}
