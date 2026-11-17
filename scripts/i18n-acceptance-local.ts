import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { crc32 } from "../lib/archive/crc32";
import { corePackKey, manifestKey } from "../lib/archive/object-keys";
import { FILE_POLICY_VERSION, PACKER_VERSION } from "../lib/archive/file-policy";
import type { ArchiveManifest } from "../lib/archive/manifest";
import { netplayRecordingKey } from "../app/.server/db/netplay-recordings";
import { getPlatformProxy } from "wrangler";
import { hashSessionToken, SESSION_COOKIE_NAME } from "../app/.server/auth/session-token";
import type { AcceptanceTui } from "./i18n-acceptance-tui";

export const ORIGINAL_CONTENT = "I18N 原文の紹介 — original content 2026";
export const LOCAL_PASSWORD = "system-test-password";
const passwordHash = "scrypt$32768$8$3$QdLo-2n6vY0f1uWwq2pMPA$-di8_t7Ig7hpcVrgFaRS6mPtEWOqt-fyxi5HV5A0Qm4";

export async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法分配本地端口");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

export class LocalAcceptanceSite {
  private children = new Set<ChildProcess>();
  readonly origin: string;
  constructor(private directory: string, private tui: AcceptanceTui, private port: number, private game = "output/easyrpg/testgame.zip") {
    this.origin = `http://127.0.0.1:${port}`;
  }

  private start(args: string[], logfile: string) {
    const log = createWriteStream(join(this.directory, logfile), { flags: "a" });
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "true", CLOUDFLARE_ENV: "", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" },
    });
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    this.children.add(child);
    child.once("close", () => { log.end(); this.children.delete(child); });
    return child;
  }

  private async command(args: string[], logfile: string) {
    const child = this.start(args, logfile);
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve() : reject(new Error(`准备步骤退出码 ${code}，见 ${logfile}`)));
    });
    await this.tui.checkpoint();
  }

  async prepare() {
    this.tui.phase = "构建当前源码";
    this.tui.log("构建输出写入 build.log");
    await this.command(["node_modules/@react-router/dev/bin.cjs", "build"], "build.log");
    const config = join(this.directory, "wrangler.json");
    const state = join(this.directory, "state");
    writeFileSync(config, JSON.stringify({
      name: "viprpg-i18n-acceptance", main: resolve("build/server/index.js"),
      compatibility_date: "2026-04-30", compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
      d1_databases: [{ binding: "DB", database_name: "viprpg-i18n-acceptance", database_id: "00000000-0000-0000-0000-000000000071", migrations_dir: resolve("migrations") }],
      r2_buckets: [{ binding: "ARCHIVE_BUCKET", bucket_name: "viprpg-i18n-acceptance" }],
      durable_objects: { bindings: [{ name: "VIEW_STATS", class_name: "ViewStats" }, { name: "SEA_ROOM", class_name: "EternalSeaRoom" }, { name: "MESSAGE_ROOM", class_name: "MessageRoom" }] },
      exports: { ViewStats: { type: "durable-object", storage: "sqlite" }, EternalSeaRoom: { type: "durable-object", storage: "sqlite" }, MessageRoom: { type: "durable-object", storage: "sqlite" } },
      assets: { directory: resolve("build/client"), binding: "ASSETS", html_handling: "none", not_found_handling: "none" },
      ratelimits: [
        { name: "AUTH_EMAIL_RATE_LIMITER", namespace_id: "1", simple: { limit: 100, period: 60 } },
        { name: "VIEW_RATE_LIMITER", namespace_id: "2", simple: { limit: 1000, period: 60 } },
      ],
      vars: { APP_ORIGIN: this.origin, AUTH_SECRET: "i18n-local-acceptance-secret", EMAIL_FROM: "acceptance@example.test", SITE_NOINDEX: "true" },
    }, null, 2));
    const cli = "node_modules/wrangler/wrangler-dist/cli.js";
    this.tui.phase = "迁移独立测试数据库";
    await this.command([cli, "d1", "migrations", "apply", "DB", "--local", "--config", config, "--persist-to", state], "setup.log");
    this.tui.phase = "创建测试账号和内容";
    const platform = await getPlatformProxy<{ DB: D1Database; ARCHIVE_BUCKET: R2Bucket }>({ configPath: config, persist: { path: join(state, "v3") }, remoteBindings: false, envFiles: [] });
    const tokens = { admin: randomBytes(32).toString("base64url"), member: randomBytes(32).toString("base64url") };
    try {
      const statements = [
        `INSERT INTO users(id,external_auth_id,email,password_hash,display_name,email_verified_at) VALUES(1,'email:i18n-root@example.test','i18n-root@example.test','${passwordHash}','I18N Root',CURRENT_TIMESTAMP),(2,'email:i18n-member@example.test','i18n-member@example.test','${passwordHash}','I18N 用户',CURRENT_TIMESTAMP)`,
        "INSERT INTO user_roles(user_id,role_id) SELECT 1,id FROM roles WHERE key='super_admin'",
        "INSERT INTO user_roles(user_id,role_id) SELECT 2,id FROM roles WHERE key='uploader'",
        `WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM n WHERE id<25) INSERT INTO works(id,original_title,chinese_title,description,status,audience,show_on_home,engine_family,created_by_user_id,published_at) SELECT id,'I18N Original '||id,'验收作品 '||id,'${ORIGINAL_CONTENT}','published','public',1,'rpg_maker_mv',2,CURRENT_TIMESTAMP FROM n`,
        "INSERT INTO work_uploaders(work_id,user_id) SELECT id,2 FROM works",
        "INSERT INTO work_external_links(work_id,label,url,link_type) SELECT id,'Original download','https://example.test/game','download_page' FROM works",
        "INSERT INTO creators(id,name,name_key,public_at) VALUES(1,'I18N 作者','i18n 作者',CURRENT_TIMESTAMP)",
        "INSERT INTO characters(id,primary_name,primary_name_key,original_name,original_name_key,description) VALUES(1,'验收角色','验收角色','テストキャラ','テストキャラ','Original character description')",
        "INSERT INTO catalogs(id,owner_user_id,title,description) VALUES(1,2,'I18N 目录','Original collection note')",
        "INSERT INTO catalog_items(catalog_id,work_id,sort_order,note) VALUES(1,1,0,'用户原文メモ')",
        "INSERT INTO tags(name,namespace) VALUES('验收标签','other')",
        "INSERT INTO work_tags(work_id,tag_name) VALUES(1,'验收标签')",
        "INSERT INTO inbox_items(id,type,status,recipient_user_id,title,body) VALUES(1,'system_notice','open',2,'Original notice title','Original notice body')",
        "INSERT INTO forum_topics(id,user_id,title,revision,write_token,request_key,request_hash) VALUES(1,2,'I18N 原文话题','revision','write','topic-request','fixture')",
        "INSERT INTO forum_posts(id,topic_id,post_number,user_id,body,revision,request_key,request_hash) VALUES(1,1,1,2,'Original forum body 用户原文','revision','post-request','fixture')",
        "INSERT INTO forum_posts(id,topic_id,post_number,user_id,body,revision,request_key,request_hash,next_comment_number) VALUES(2,1,2,1,'Original second floor 二楼原文','revision','second-post-request','fixture',2)",
        "INSERT INTO forum_post_comments(id,post_id,user_id,body,revision,request_key,request_hash) VALUES(1,2,2,'Original nested reply 楼中楼原文','revision','comment-request','fixture')",
        "UPDATE forum_topics SET next_post_number=3,reply_count=2,last_activity_at=CURRENT_TIMESTAMP,last_post_id=NULL,last_comment_id=1 WHERE id=1",
        "INSERT INTO direct_conversations(id,lower_user_id,upper_user_id) VALUES(1,1,2)",
        "INSERT INTO direct_conversation_states(conversation_id,user_id) VALUES(1,1),(1,2)",
        "INSERT INTO direct_messages(id,conversation_id,sender_user_id,recipient_user_id,client_id,kind,body) VALUES(1,1,1,2,'fixture-message','text','Original private message 私信原文')",
        "INSERT INTO direct_message_reports(id,user_id,peer_user_id,conversation_id,reason,explanation) VALUES(1,2,1,1,'other','Original report explanation')",
        `INSERT INTO auth_audit_logs(user_id,event_type,detail_json) VALUES(2,'external_work_created','{"targets":[{"type":"work","id":1,"name":"验收作品 1"}],"before":null,"after":{"id":1,"originalTitle":"I18N Original 1","chineseTitle":"验收作品 1","description":"${ORIGINAL_CONTENT}"}}')`,
        "INSERT INTO resources(id,kind,slug,name) VALUES('i18n-resource','website','i18n-resource','I18N resource')",
        "INSERT INTO import_jobs(id,work_id,uploader_id,status) VALUES(1,1,2,'created')",
      ];
      await platform.env.DB.batch(statements.map(sql => platform.env.DB.prepare(sql)));
      // Reuse the real EasyRPG regression ZIP. Hashes are required by the archive protocol.
      const pack = readFileSync(this.game);
      const files = Object.entries(unzipSync(pack)).filter(([path]) => !path.endsWith("/"));
      if (!files.some(([path]) => path === "RPG_RT.ldb")) throw new Error("--game 必须是根目录含 RPG_RT.ldb 的 EasyRPG 测试 ZIP");
      const packHash = createHash("sha256").update(pack).digest("hex");
      const size = files.reduce((sum, [, bytes]) => sum + bytes.length, 0);
      const manifest: ArchiveManifest = {
        schema: "viprpg-archive.manifest.v1",
        game: { originalTitle: "I18N Original 1", chineseTitle: "验收作品 1", language: "ja", isOriginal: true, isTranslation: false },
        archiveVersion: { sourceName: "EasyRPG UI acceptance", sourceUrl: null, createdAt: new Date().toISOString(),
          filePolicyVersion: FILE_POLICY_VERSION, packerVersion: PACKER_VERSION, sourceType: "browser_zip",
          sourceFileCount: files.length, sourceSize: size, includedFileCount: files.length, includedSize: size, excludedFileCount: 0, excludedSize: 0 },
        corePacks: [{ id: "fixture", sha256: packHash, size: pack.length, uncompressedSize: size, fileCount: files.length, format: "zip", compression: "deflate-low" }],
        files: files.map(([path, bytes]) => ({ path, pathSortKey: path.toLowerCase(), size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"), crc32: crc32(bytes), mtimeMs: null,
          role: path.endsWith(".ldb") ? "database" : /\.(lmt|lmu)$/.test(path) ? "map" : "asset",
          storage: { kind: "core_pack", packId: "fixture", entry: path } })),
      };
      const manifestText = JSON.stringify(manifest);
      const manifestHash = createHash("sha256").update(manifestText).digest("hex");
      await platform.env.ARCHIVE_BUCKET.put(corePackKey(packHash), pack);
      await platform.env.ARCHIVE_BUCKET.put(manifestKey(manifestHash), manifestText);
      await platform.env.DB.batch([
        platform.env.DB.prepare("UPDATE works SET engine_family='rpg_maker_2000' WHERE id=1"),
        platform.env.DB.prepare(`INSERT INTO archive_versions(id,work_id,manifest_sha256,file_policy_version,packer_version,source_type,
          source_file_count,source_size_bytes,total_files,total_size_bytes,core_pack_count,core_pack_size_bytes,estimated_r2_get_count,
          web_play_file_count,web_play_size_bytes,is_current,uploader_id,status,published_at)
          VALUES(1,1,?,?,?,'browser_zip',?,?,?,?,1,?,1,?,?,1,2,'published',CURRENT_TIMESTAMP)`)
          .bind(manifestHash, FILE_POLICY_VERSION, PACKER_VERSION, files.length, size, files.length, size, pack.length, files.length, size),
        platform.env.DB.prepare("INSERT INTO core_packs(id,sha256,size_bytes,uncompressed_size_bytes,file_count,first_seen_archive_version_id) VALUES(1,?,?,?,?,1)")
          .bind(packHash, pack.length, size, files.length),
        platform.env.DB.prepare("INSERT INTO archive_version_core_pack_refs(archive_version_id,core_pack_id) VALUES(1,1)"),
        platform.env.DB.prepare("INSERT INTO netplay_matches(id,game_match_key,started_at,room_json) VALUES('i18n-match',1,?,?)")
          .bind(Date.now(), JSON.stringify({ roomId: 1, route: "direct", backup: "websocket" })),
        platform.env.DB.prepare("INSERT INTO netplay_match_seats(match_id,seat,user_id,display_name,work_id,archive_version_id) VALUES('i18n-match',1,1,'I18N Root',1,1),('i18n-match',2,2,'I18N 用户',1,1)"),
      ]);
      for (const seat of [1, 2]) {
        await platform.env.ARCHIVE_BUCKET.put(netplayRecordingKey("i18n-match", seat, 0), JSON.stringify([
          ["remote", 1, 0, 0, "direct"], ["diagnostic", { kind: "wait_end", durationMs: 25 }],
        ]));
        await platform.env.DB.prepare("INSERT INTO netplay_match_chunks(match_id,seat,seq,terminal_json,end_reason,received_at) VALUES('i18n-match',?,0,'[60,1,0]','settled',?)")
          .bind(seat, Date.now()).run();
      }
      for (const [persona, id] of [["admin", 1], ["member", 2]] as const) {
        await platform.env.DB.prepare("INSERT INTO user_sessions(user_id,session_hash,expires_at) VALUES(?,?,datetime('now','+1 day'))")
          .bind(id, await hashSessionToken(tokens[persona])).run();
      }
    } finally { await platform.dispose(); }
    this.tui.phase = "启动本地 Worker";
    const worker = this.start([cli, "dev", "--config", config, "--local", "--persist-to", state, "--ip", "127.0.0.1", "--port", String(this.port), "--show-interactive-dev-session=false", "--log-level", "warn"], "worker.log");
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await this.tui.checkpoint();
      if (worker.exitCode !== null) throw new Error("本地 Worker 提前退出，见 worker.log");
      const response = await fetch(this.origin + "/api/health", { signal: AbortSignal.timeout(3000) }).catch(() => null);
      if (response?.ok) return { origin: this.origin, tokens, cookieName: SESSION_COOKIE_NAME };
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("本地 Worker 在 120 秒内未就绪，见 worker.log");
  }

  async stop() {
    for (const child of this.children) {
      if (!child.pid || child.exitCode !== null) continue;
      if (process.platform === "win32") {
        await new Promise<void>(resolve => {
          const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          killer.once("error", () => resolve());
          killer.once("close", () => resolve());
        });
      } else child.kill("SIGTERM");
    }
  }
}
