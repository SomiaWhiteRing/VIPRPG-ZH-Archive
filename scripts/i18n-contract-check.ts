import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import { UI_LOCALES, browserUiLocale, parseUiLocale, requestUiLocale, preserveUiLocale, preserveFormRedirectLocale, withoutUiLocale, type UiLocale } from "../lib/i18n/locale";
import { parseUiLanguagePreference } from "../lib/account-preferences";
import { authReturnUrl, sanitizeRedirectPath } from "../app/.server/auth/redirect";
import { redirectResponse } from "../app/.server/http/form";
import { createRuntime } from "../app/.server/runtime";
import { getCurrentUser } from "../app/.server/auth/current-user";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../app/.server/auth/session-token";
import { POST as savePreferences } from "../app/.server/endpoints/api/account/privacy/route";

const origin = "https://i18n.example.test";
const locales = Object.keys(UI_LOCALES) as UiLocale[];

test("语言值只接受支持的 UI 语言；账号另接受 auto", () => {
  for (const locale of locales) {
    assert.equal(parseUiLocale(locale), locale);
    assert.equal(parseUiLanguagePreference(locale), locale);
  }
  assert.equal(parseUiLanguagePreference("auto"), "auto");
  for (const value of [null, "", "auto", "zh-CN", "fr", "toString"]) assert.equal(parseUiLocale(value), null);
  for (const value of [null, undefined, "", "fr", "zh-CN", true, {}]) assert.throws(() => parseUiLanguagePreference(value));
});

test("浏览器语言遵循权重、语言地区和默认语言", () => {
  const examples: [string | null, UiLocale][] = [
    [null, "zh-Hans"], ["de-DE,*;q=0.1", "zh-Hans"], ["zh-TW", "zh-Hans"], ["JA-jp", "ja"], ["en-GB", "en"],
    ["en;q=0.2,ja;q=0.9,zh-CN;q=0.5", "ja"], ["ja;q=0,en;q=0.8", "en"], ["ja;q=invalid,en;q=0.5", "en"],
    ["ja;q=2,en;q=0.5", "en"], ["en;q=0.5,ja;q=0.5", "en"], ["ja;q=0.5,en", "en"],
  ];
  for (const [header, expected] of examples) assert.equal(browserUiLocale(header), expected, String(header));
});

test("URL 语言优先于账号；auto 随浏览器变化；旧 cookie 不覆盖选择", () => {
  for (const browser of locales) for (const preference of ["auto", ...locales] as const) for (const explicit of [null, "invalid", ...locales]) {
    const url = new URL("/about", origin);
    if (explicit !== null) url.searchParams.set("lang", explicit);
    const request = new Request(url, { headers: { "Accept-Language": browser, Cookie: "viprpg_ui_locale=ja" } });
    const expected = explicit && locales.includes(explicit as UiLocale) ? explicit : preference === "auto" ? browser : preference;
    assert.equal(requestUiLocale(request, preference), expected, `${browser}/${preference}/${explicit}`);
  }
});

test("站内链接保留语言、重复查询参数和锚点；auto 不固定语言", () => {
  for (const locale of locales) {
    const source = new URL(`/about?lang=${locale}`, origin);
    const target = preserveUiLocale(new URL("/games?tag=a&tag=b#comments", origin), source);
    assert.equal(target.pathname, "/games");
    assert.deepEqual(target.searchParams.getAll("tag"), ["a", "b"]);
    assert.equal(target.searchParams.get("lang"), locale);
    assert.equal(target.hash, "#comments");
    assert.equal(withoutUiLocale(target.search).toString(), "tag=a&tag=b");
    const explicit = new URL("/games?lang=en", origin);
    assert.equal(preserveUiLocale(explicit, source).searchParams.get("lang"), "en");
    const external = new URL("https://external.example.test/?tag=a#comments");
    assert.equal(preserveUiLocale(external, source).href, "https://external.example.test/?tag=a#comments");
  }
  assert.equal(preserveUiLocale(new URL("/games?tag=a#comments", origin), new URL("/about", origin)).search, "?tag=a");
});

test("认证返回地址及 HTTP 重定向保留原路径、查询、语言和锚点", () => {
  for (const locale of locales) {
    const path = "/games/1?tag=a&tag=b&q=" + encodeURIComponent("用户原文の内容") + "#sec-comments";
    const target = authReturnUrl(sanitizeRedirectPath(path), `${origin}/api/auth/login?lang=${locale}`);
    const response = redirectResponse(target);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("Location"), target.href);
    assert.equal(target.pathname, "/games/1");
    assert.deepEqual(target.searchParams.getAll("tag"), ["a", "b"]);
    assert.equal(target.searchParams.get("q"), "用户原文の内容");
    assert.equal(target.searchParams.get("lang"), locale);
    assert.equal(target.hash, "#sec-comments");
  }
  for (const path of ["https://external.example.test", "//external.example.test", "/\\external.example.test", "/\nexternal.example.test"])
    assert.equal(sanitizeRedirectPath(path), "/");
});

test("表单返回遵循提交期间的新语言选择，并保留锚点和显式目标语言", () => {
  const submitted = new URL("/login?lang=ja", origin);
  const target = new URL("/games/1?audit=keep#sec-comments", origin);
  preserveFormRedirectLocale(target, submitted, new URL("/login?lang=en", origin), "ja");
  assert.equal(target.searchParams.get("lang"), "en");
  assert.equal(target.searchParams.get("audit"), "keep");
  assert.equal(target.hash, "#sec-comments");
  const explicit = new URL("/games/1?lang=zh-Hans#sec-comments", origin);
  preserveFormRedirectLocale(explicit, submitted, submitted, "ja");
  assert.equal(explicit.searchParams.get("lang"), "zh-Hans");
  const automatic = new URL("/me/privacy?settingsUpdated=1", origin);
  preserveFormRedirectLocale(automatic, new URL("/me/privacy", origin), new URL("/me/privacy", origin), null);
  assert.equal(automatic.search, "?settingsUpdated=1");
});

test("账号默认 auto；保存跨会话生效；恢复 auto；旧表单和无效输入不改语言", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys=ON");
    for (const name of readdirSync("migrations").filter(name => name.endsWith(".sql")).sort())
      sqlite.exec(readFileSync(`migrations/${name}`, "utf8"));
    sqlite.exec("INSERT INTO users(id,external_auth_id,email,display_name) VALUES(1,'i18n-contract-1','one@example.test','One'),(2,'i18n-contract-2','two@example.test','Two')");
    // Only the D1 transport is adapted; execute production SQL and real migrations.
    const db = { prepare(sql: string) {
      const statement = sqlite.prepare(sql);
      let values: SQLInputValue[] = [];
      return {
        bind(...bindings: SQLInputValue[]) { values = bindings; return this; },
        async first(column?: string) { const row = statement.get(...values); return column ? row?.[column] ?? null : row ?? null; },
        async run() { const result = statement.run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
      };
    } } as unknown as D1Database;
    const env = { DB: db, APP_ORIGIN: origin } as CloudflareEnv;
    const tokens = ["a".repeat(43), "b".repeat(43), "c".repeat(43)];
    for (const [index, token] of tokens.entries()) sqlite.prepare("INSERT INTO user_sessions(user_id,session_hash,expires_at) VALUES(?,?,datetime('now','+1 day'))")
      .run(index === 2 ? 2 : 1, await hashSessionToken(token));
    const runtimeFor = (token: string, browser: UiLocale, language?: string, explicit?: UiLocale, submit = false) => {
      const form = new FormData();
      form.set("section", "preferences"); form.set("shortcuts", "[]");
      if (language !== undefined) form.set("uiLanguage", language);
      return createRuntime(new Request(`${origin}${submit ? "/api/account/privacy" : "/about"}${explicit ? `?lang=${explicit}` : ""}`, {
        method: submit ? "POST" : "GET", body: submit ? form : undefined,
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}`, Origin: origin, "Accept-Language": browser },
      }), env, { waitUntil() {}, passThroughOnException() {} });
    };
    const initial = runtimeFor(tokens[0], "ja");
    assert.equal((await getCurrentUser(initial))?.preferences.uiLanguage, "auto");
    assert.equal(initial.uiLocale, "ja");
    for (const language of [...locales, "auto"] as const) {
      const write = runtimeFor(tokens[0], "en", language, "ja", true);
      const response = await savePreferences(write, write.request);
      assert.equal(response.status, 303);
      const destination = new URL(response.headers.get("Location")!);
      assert.equal(destination.pathname, "/me/privacy");
      assert(!destination.searchParams.has("lang"), "保存后应使用账号选择，不能被旧 URL 固定");
      assert(!destination.searchParams.has("error"));
      for (const [index, browser] of (["en", "ja"] as const).entries()) {
        const read = runtimeFor(tokens[index], browser);
        assert.equal((await getCurrentUser(read))?.preferences.uiLanguage, language);
        assert.equal(read.uiLocale, language === "auto" ? browser : language);
      }
      const other = runtimeFor(tokens[2], "en");
      assert.equal((await getCurrentUser(other))?.preferences.uiLanguage, "auto");
      assert.equal(other.uiLocale, "en");
      const override = runtimeFor(tokens[1], "en", undefined, "zh-Hans");
      await getCurrentUser(override);
      assert.equal(override.uiLocale, "zh-Hans");
    }
    const pinned = runtimeFor(tokens[0], "ja", "en", undefined, true);
    await savePreferences(pinned, pinned.request);
    for (const language of [undefined, "invalid"]) {
      const write = runtimeFor(tokens[0], "ja", language, "ja", true);
      const response = await savePreferences(write, write.request);
      const destination = new URL(response.headers.get("Location")!);
      assert.equal(destination.searchParams.has("error"), language === "invalid");
      const read = runtimeFor(tokens[1], "ja");
      assert.equal((await getCurrentUser(read))?.preferences.uiLanguage, "en");
      assert.equal(read.uiLocale, "en");
    }
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { sqlite.close(); }
});
