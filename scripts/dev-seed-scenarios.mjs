// 补充日常开发场景；固定编号只插入缺失记录，保留后续手工编辑。
import { createHash, randomBytes, pbkdf2Sync } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import { forumSearchTokens } from "../lib/forum-search-index.ts";
import { searchScopeSql } from "../lib/server/forum/search-index.ts";
import passwordPolicy from "../lib/server/auth/password-policy.json" with { type: "json" };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const now = "2026-09-12 08:00:00";
const key = (value) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const quote = (value) => value == null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replace(/'/g, "''")}'`;

export async function seedDevScenarios() {
  // SQLite online backup includes committed WAL contents without stopping next dev.
  const dbDir = join(root, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  const candidates = readdirSync(dbDir).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  if (candidates.length !== 1) throw new Error("无法唯一定位开发数据库；请先初始化默认本地 D1。");
  const source = new DatabaseSync(join(dbDir, candidates[0]), { readOnly: true });
  const outputDir = join(root, "output/dev-seed", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(outputDir, { recursive: true });
  try {
    await backup(source, join(outputDir, "before.sqlite"));
  } finally {
    source.close();
  }
  const candidatePath = join(outputDir, "candidate.sqlite");
  const before = new DatabaseSync(join(outputDir, "before.sqlite"), { readOnly: true });
  try {
    await backup(before, candidatePath);
  } finally {
    before.close();
  }
  const candidate = new DatabaseSync(candidatePath);
  let statements;
  try {
    candidate.exec("PRAGMA foreign_keys=ON");
    statements = scenarioStatements(candidate);
    candidate.exec(`BEGIN;\n${statements.join("\n")}\n`);
    const mapping=`INSERT INTO forum_search_documents(post_id,comment_id)
      SELECT post_id,comment_id FROM (
        SELECT p.id AS post_id,NULL AS comment_id,p.created_at,0 AS kind,p.id FROM forum_posts p WHERE NOT EXISTS(SELECT 1 FROM forum_search_documents d WHERE d.post_id=p.id)
        UNION ALL SELECT NULL,c.id,c.created_at,1,c.id FROM forum_post_comments c WHERE NOT EXISTS(SELECT 1 FROM forum_search_documents d WHERE d.comment_id=c.id)
      ) ORDER BY created_at,kind,id;`;
    candidate.exec(mapping);statements.push(mapping);
    const missing=candidate.prepare(`SELECT d.id,CASE WHEN p.post_number=1 THEN t.title ELSE '' END AS title,COALESCE(p.body,c.body) AS body
      FROM forum_search_documents d LEFT JOIN forum_posts p ON p.id=d.post_id LEFT JOIN forum_post_comments c ON c.id=d.comment_id
      LEFT JOIN forum_topics t ON t.id=p.topic_id WHERE COALESCE(p.status,c.status)<>'deleted' AND NOT EXISTS(SELECT 1 FROM forum_search_index f WHERE f.rowid=d.id)`).all();
    for(const row of missing){
      const encoded=forumSearchTokens(row.body);
      const statement=`INSERT INTO forum_search_index(rowid,title,body,scope) SELECT d.id,${quote(forumSearchTokens(row.title??""))},${quote(encoded.slice(0,32000))},${searchScopeSql} FROM forum_search_documents d WHERE d.id=${row.id};`;
      candidate.exec(statement);statements.push(statement);
      for(let start=32000;start<encoded.length;start+=32000){
        const append=`UPDATE forum_search_index SET body=body||${quote(encoded.slice(start,start+32000))} WHERE rowid=${row.id};`;
        candidate.exec(append);statements.push(append);
      }
    }
    candidate.exec("COMMIT");
    writeFileSync(join(outputDir, "scenarios.sql"), `${statements.join("\n")}\n`);
    if (candidate.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("候选数据存在外键错误，未写入开发库。");
    }
  } finally {
    candidate.close();
  }
  const platform = await getPlatformProxy({
    configPath: join(root, "wrangler.jsonc"),
    persist: { path: join(root, ".wrangler/state/v3") },
    remoteBindings: false,
  });
  try {
    // One D1 transaction: a failed insert does not leave half a scenario behind.
    const results = await platform.env.DB.batch(statements.map((sql) => platform.env.DB.prepare(sql)));
    const changes = results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
    const report = { changes, statements: statements.length, backup: join(outputDir, "before.sqlite") };
    writeFileSync(join(outputDir, "result.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`本地扩展场景已写入：${changes} 行变更。备份与 SQL：${outputDir}`);
  } finally {
    await platform.dispose();
  }
}

function scenarioStatements(db) {
  const sql = [];
  const insert = (table, row, conflict = "id") => sql.push(
    `INSERT INTO ${table} (${Object.keys(row).join(",")}) VALUES (${Object.values(row).map(quote).join(",")}) ON CONFLICT(${conflict}) DO NOTHING;`,
  );
  const requireRow = (query, ...values) => {
    const row = db.prepare(query).get(...values);
    if (!row) throw new Error(`缺少基础 seed 记录：${query}；请先运行本地 migration 和基础 seed。`);
    return row;
  };
  const users = Object.fromEntries(["super", "admin", "uploader", "user"].map((name) => [
    name, requireRow("SELECT id FROM users WHERE email=?", `${name}@dev.local`).id,
  ]));
  db.prepare("SELECT id FROM forum_topics LIMIT 0").all();
  requireRow("SELECT id,extra_json FROM works WHERE id=1");
  const avatar = requireRow("SELECT avatar_blob_sha256 AS sha FROM creators WHERE id=1").sha;
  const pictures = db.prepare("SELECT id,blob_sha256 FROM media_assets WHERE id BETWEEN 1 AND 4 ORDER BY id").all();
  if (pictures.length !== 4 || !avatar) throw new Error("基础 seed 的头像或预览图不完整。");
  const salt = randomBytes(16);
  const password = `pbkdf2-sha256$${passwordPolicy.iterations}$${salt.toString("base64url")}$${pbkdf2Sync("dev123456789", salt, passwordPolicy.iterations, 32, "sha256").toString("base64url")}`;
  const accounts = [
    [10001, "wiki", "维基人小夏", "active", 1],
    [10002, "curator", "讨论策展人", "active", 1],
    [10003, "private", "低调收藏家", "active", 0],
    [10004, "applicant", "资料整理申请者", "active", 1],
    [10005, "disabled", "已停用的演示账户", "disabled", 1],
    [10006, "deleted", "已注销用户", "deleted", 0],
  ];
  for (const [id, email, name, status, visible] of accounts) {
    const existing = db.prepare("SELECT external_auth_id FROM users WHERE id=?").get(id);
    if (existing && existing.external_auth_id !== `dev-scenario-${id}`) {
      throw new Error(`演示账号编号 ${id} 已被其他账户占用，未写入。`);
    }
    insert("users", {
      id, external_auth_id: `dev-scenario-${id}`, email: status === "deleted" ? null : `${email}@dev.local`,
      password_hash: status === "deleted" ? null : password, display_name: name, status,
      avatar_blob_sha256: status === "deleted" ? null : avatar,
      bio: status === "deleted" ? "" : "本地演示账户：整理作品资料、收藏短篇并参与讨论。",
      profile_show_bio: visible, profile_show_favorites: visible, profile_show_history: visible,
      profile_show_catalogs: visible, profile_show_comments: visible,
      email_verified_at: status === "deleted" ? null : now, created_at: now, updated_at: now,
    });
  }
  const wikiPermissions = [
    "work.lookup_non_deleted", "work.read_private", "work.metadata.update_any",
    "creator.read_private", "creator.metadata.update_any", "character.read_private", "character.metadata.update_any",
    "tag.read_private", "tag.metadata.update_any", "relation.create_any", "relation.update_any", "relation.delete_any",
    "translation_relation.create_any", "translation_relation.delete_any",
  ];
  const roles = [
    [10001, "wiki_editor", "维基人", 300, "active", wikiPermissions],
    [10002, "dev_forum_curator", "讨论策展人", 250, "active", ["forum.topic.feature_any"]],
    [10003, "dev_retired_editor", "已停用资料协作组", 200, "disabled", ["creator.read_private"]],
  ];
  for (const [id, roleKey, name, priority, status, permissions] of roles) {
    insert("roles", { id, key: roleKey, name, priority, status, kind: "custom", description: `${name}本地展示身份`, created_at: now, updated_at: now });
    for (const permission of permissions) insert("role_permissions", { role_id: id, permission_key: permission }, "role_id,permission_key");
  }
  for (const id of [10001, 10002]) insert("user_roles", { user_id: id, role_id: id }, "user_id,role_id");

  const works = [
    [10001, "雪原に届く手紙", "寄往雪原的信", "2024", "year", "ja", 0, 0, "published"],
    [10002, "雪原に届く手紙", "寄往雪原的信（中文译本）", "2024-12", "month", "zh-CN", 0, 1, "published"],
    [10003, "夏祭之后的约定", "夏祭之后的约定", "2026-09-01", "day", "zh-CN", 1, 0, "published"],
    [10004, "雪原短篇设定集", null, null, "unknown", "ja", 0, 0, "hidden"],
    [10005, "已撤下的活动演示作品", null, "2023", "year", "zh-CN", 1, 0, "deleted"],
  ];
  for (const [id, original, chinese, date, precision, language, isOriginal, isTranslation, status] of works) {
    insert("works", {
      id, original_title: original, chinese_title: chinese, language, is_original: isOriginal, is_translation: isTranslation,
      original_release_date: date, original_release_precision: precision, engine_family: "rpg_maker_mv", status,
      description: "虚构的本地资料展示作品。沿着雪原上的足迹寻找送信人，途中结识不同身份的旅伴。外部地址仅作占位。",
      extra_json: JSON.stringify({ moreInfo: [
        { title: "游玩提示", body: "建议先完成一个结局再阅读设定集。\n方向键移动，确认键调查；分支前可保留存档。" },
        { title: "制作与授权说明", body: "这是本地演示资料，用于展示自定义信息的多段文本、顺序和署名。\n作者、角色身份与下载地址均不代表真实发行。" },
        ...(isTranslation ? [{ title: "翻译说明", body: "中文译名参考角色词典；保留原作署名，并列出翻译、校对和测试人员。" }] : []),
      ] }), created_by_user_id: users.uploader, created_at: now, updated_at: now, published_at: status === "published" ? now : null,
    });
    insert("work_external_links", { id, work_id: id, label: "演示下载页（占位）", url: `https://example.com/dev-works/${id}`, link_type: "download_page", created_at: now });
    insert("work_uploaders", { work_id: id, user_id: users.uploader, created_at: now }, "work_id,user_id");
    if (id <= 10003) insert("work_uploaders", { work_id: id, user_id: 10001, created_at: now }, "work_id,user_id");
    for (let i = 0; i < (id === 10001 ? 3 : 1); i++) insert("work_media_assets", { work_id: id, media_asset_id: pictures[i].id, sort_order: i + 1, is_primary: i === 0 ? 1 : 0 }, "work_id,media_asset_id");
  }
  insert("work_titles", { id: 10001, work_id: 10001, title: "Letters Across the Snow", language: "en", title_type: "alias", created_at: now });
  insert("work_external_links", { id: 10011, work_id: 10001, label: "设定资料（占位）", url: "https://example.com/dev-works/snow-notes", link_type: "wiki", created_at: now });
  for (const [id, from, to, type, reverse] of [[10001, 10003, 10001, "prequel", 0], [10002, 10001, 10003, "sequel", 1]]) {
    insert("work_relations", { id, from_work_id: from, to_work_id: to, relation_type: type, vice_versa: reverse, created_by_user_id: 10001, created_at: now });
  }
  for (const [id, from, to, role, reverse] of [[10001, 10002, 10001, "original", 0], [10002, 10001, 10002, "translation", 1]]) {
    insert("translation_relations", { id, source_work_id: from, target_work_id: to, target_role: role, vice_versa: reverse, created_by_user_id: users.uploader, created_at: now });
  }

  for (const [id, name] of [[10001, "雪灯工作室"], [10002, "纸风铃汉化组"], [10003, "青苔音房"]]) {
    insert("creators", { id, name, name_key: key(name), avatar_blob_sha256: avatar, website_url: `https://example.com/dev-creators/${id}`, extra_json: JSON.stringify({ bio: "虚构的本地演示制作人，展示跨作品署名和同一人物的多种职责。" }), created_at: now, updated_at: now });
  }
  for (const [id, creator, name] of [[10001, 10001, "雪灯"], [10002, 10001, "Snow Lantern"], [10003, 10002, "纸风铃"], [10004, 10003, "Moss Sound"]]) {
    insert("creator_aliases", { id, creator_id: creator, name, name_key: key(name), source: "admin", created_at: now });
  }
  for (const work of [10001, 10002, 10003]) {
    for (const [creator, name, role, label, notes] of [
      [10001, work === 10003 ? "雪灯" : "Snow Lantern", "author", null, "原作作者"],
      [10001, "雪灯", "scenario", null, "同一作者兼任剧本"],
      [10001, "雪灯工作室", "graphics", null, "地图与立绘"],
      [10003, "Moss Sound", "music", null, "原创配乐"],
      [10002, "纸风铃", "planning", null, "进度与资料整理"],
      [10001, "雪灯", "programming", null, "事件制作"],
      [10002, "纸风铃汉化组", "other", "校对与测试", "自定义职务名称"],
      ...(work === 10002 ? [[10002, "纸风铃", "translator", null, "简体中文翻译"]] : []),
    ]) insert("work_staff", { work_id: work, creator_id: creator, display_name: name, role_key: role, role_label: label, notes }, "work_id,creator_id,role_key");
  }
  const character = requireRow("SELECT id FROM characters WHERE original_name='アゼクラ'");
  const portrait = requireRow("SELECT p.* FROM character_default_portraits d JOIN character_portrait_refs p ON p.id=d.portrait_ref_id WHERE d.character_id=?", character.id);
  // Select a different cell of an existing bound sheet, retaining its real image.
  const sheet = requireRow("SELECT width_px,height_px FROM face_sheets WHERE id=?", portrait.face_sheet_id);
  const columns = Math.floor(sheet.width_px / 48);
  const rows = Math.floor(sheet.height_px / 48);
  const cell = (portrait.cell_row * columns + portrait.cell_column + 1) % (columns * rows);
  insert("character_portrait_refs", { id: 10001, character_id: character.id, face_sheet_id: portrait.face_sheet_id, cell_row: Math.floor(cell / columns), cell_column: cell % columns, created_by_user_id: users.admin, created_at: now });
  for (const [id, work, name, role, spoiler, ref, order] of [
    [10001, 10001, "雪原邮差", "main", 0, 10001, 0],
    [10002, 10001, "无名旅人", "cameo", 1, null, 1],
    [10003, 10002, "阿泽库拉", "supporting", 0, null, 0],
    [10004, 10003, "传闻中的校仓", "mentioned", 0, null, 0],
    [10005, 10003, "片尾旁白", "other", 1, null, 1],
  ]) insert("work_characters", { id, work_id: work, character_id: character.id, display_name: name, role_key: role, spoiler_level: spoiler, portrait_ref_id: ref, sort_order: order, notes: "演示同一角色在不同作品、不同身份中的展示名。" });
  for (const [id, name, namespace] of [[10001, "剧情向", "genre"], [10002, "多结局", "genre"], [10003, "资料演示", "technical"]]) {
    insert("tags", { id, name, namespace, created_at: now, updated_at: now });
    for (const work of [10001, 10002, 10003]) insert("work_tags", { work_id: work, tag_id: id, source: "admin", created_at: now }, "work_id,tag_id");
  }

  for (const [id, owner, status] of [[10001, 10001, "published"], [10002, 10003, "published"], [10003, users.uploader, "deleted"]]) {
    insert("catalogs", { id, owner_user_id: owner, title: status === "deleted" ? "已删除的资料演示目录" : "雪原书信：原作、译作与后日谈", description: "按游玩顺序收录，并为每个条目补充备注。", cover_blob_sha256: pictures[3].blob_sha256, status, created_at: now, updated_at: now });
    for (const [index, work] of [10001, 10002, 10003].entries()) insert("catalog_items", { catalog_id: id, work_id: work, sort_order: index, note: ["原作，可与译文对照", "简体中文译本", "同世界观的后日谈"][index], created_at: now }, "catalog_id,work_id");
  }
  for (const user of [users.user, users.uploader, 10001, 10003]) {
    for (const [index, work] of [1, 2, 10001, 10002, 10003].entries()) insert("user_work_entries", { work_id: work, user_id: user, favorited_at: index === 1 ? null : now, last_played_at: index === 2 ? null : `2026-09-${String(11 - index).padStart(2, "0")} 12:00:00`, updated_at: now }, "work_id,user_id");
  }
  for (const [id, shortcode, status, visible] of [[10001, "dev_wave", "active", 1], [10002, "dev_quiet", "active", 0], [10003, "dev_retired", "retired", 0]]) {
    insert("custom_emojis", { id, shortcode, name: `本地表情 ${shortcode}`, category: "本地演示", visible_in_picker: visible, image_blob_sha256: avatar, status, created_at: now, updated_at: now });
  }
  const comments = [
    [10001, users.user, "published", "雪原的氛围很喜欢，期待后日谈！ :dev_wave:", null, null],
    [10002, 10001, "published", "后日谈已放进同名目录，可以按备注顺序阅读。", 10001, null],
    [10003, users.user, "published", "谢谢，已经收藏了。", 10001, 10002],
    [10004, 10005, "hidden", "演示被隐藏的作品评论。", null, null],
    [10005, 10006, "deleted", null, 10001, null],
    [10006, 10006, "published", "保留已注销用户的历史评论。", null, null],
  ];
  for (const [id, user, status, body, parent, reply] of comments) insert("comments", { id, work_id: 10001, user_id: user, status, body, root_comment_id: parent, reply_to_comment_id: reply, created_at: now, updated_at: now, deleted_at: status === "deleted" ? now : null });
  insert("comments", { id: 10007, creator_id: 10001, user_id: users.user, body: "这次作者署名使用了 Snow Lantern，别名页也能找到同一位作者。", created_at: now, updated_at: now });
  for (const user of [10001, users.uploader]) insert("comment_likes", { comment_id: 10001, user_id: user, created_at: now }, "comment_id,user_id");
  insert("work_engagement_stats", { work_id: 10001, view_count: 128, updated_at: now }, "work_id");

  insert("inbox_items", { id: 10001, type: "role_change_request", status: "pending", sender_user_id: 10004, target_user_id: 10004, required_permission_key: "inbox.role_request.resolve", requested_role_id: 10001, requested_role_key_snapshot: "wiki_editor", requested_role_name_snapshot: "维基人", title: "申请成为维基人", body: "希望帮助补全雪原系列的发布日期、作者别名与角色资料。", created_at: now });
  insert("user_role_events", { id: 10001, event_key: "dev-scenario-wiki-assigned", actor_user_id: users.admin, target_user_id: 10001, action: "assigned", role_id: 10001, role_key_snapshot: "wiki_editor", role_name_snapshot: "维基人", reason: "本地演示：资料维护授权", created_at: now });
  insert("inbox_items", { id: 10002, type: "role_change_notice", status: "open", recipient_user_id: 10001, target_user_id: 10001, sender_user_id: users.admin, role_event_id: 10001, title: "已获得维基人身份", body: "可以维护作品和人物资料，具体能力可在账户权限中查看。", created_at: now });
  insert("inbox_item_reads", { item_id: 10002, user_id: 10001, read_at: now }, "item_id,user_id");
  insert("inbox_items", { id: 10003, type: "role_change_request", status: "rejected", sender_user_id: 10004, target_user_id: 10004, required_permission_key: "inbox.role_request.resolve", requested_role_id: 10002, requested_role_key_snapshot: "dev_forum_curator", requested_role_name_snapshot: "讨论策展人", resolved_by_user_id: users.admin, resolved_at: now, title: "讨论策展申请已驳回", body: "本地演示：请先积累讨论整理经验。", created_at: "2026-09-11 08:00:00" });
  insert("inbox_items", { id: 10004, type: "system_notice", status: "open", recipient_user_id: users.user, title: "本地展示数据已准备", body: "可以查看作品 10001、个人收藏与游玩历史，以及讨论区中的长帖。", created_at: now });
  insert("inbox_items", { id: 10005, type: "role_change_request", status: "approved", sender_user_id: 10001, target_user_id: 10001, required_permission_key: "inbox.role_request.resolve", requested_role_id: 10001, requested_role_key_snapshot: "wiki_editor", requested_role_name_snapshot: "维基人", role_event_id: 10001, resolved_by_user_id: users.admin, resolved_at: now, title: "维基人申请已批准", body: "本地演示：已完成的申请与授权记录。", created_at: "2026-09-11 08:00:00" });

  const forum = JSON.parse(readFileSync(join(root, "data/dev/forum.json"), "utf8"));
  const forumUser = { 1: users.super, 2: users.admin, 3: users.user };
  const idFields = new Set(["id", "topic_id", "post_id", "tag_id", "reply_to_id", "comment_id", "target_id", "last_post_id", "last_comment_id"]);
  for (const table of ["forum_tags", "forum_topics", "forum_topic_tags", "forum_posts", "forum_post_comments", "forum_content_reports"]) {
    for (const original of forum[table]) {
      const row = Object.fromEntries(Object.entries(original).map(([column, value]) => [
        column, value == null ? value : idFields.has(column) ? value + 10000 : ["user_id", "featured_by", "resolved_by"].includes(column) ? forumUser[value] : value,
      ]));
      if (row.body !== undefined) {
        if (table === "forum_posts" && original.id === 1000) row.body += "\n\n相关作品：/games/10001\n欢迎补充体验！ :dev_wave:";
      }
      if (table !== "forum_topic_tags" && table !== "forum_content_reports") row.revision = hash(`dev-${table}-${row.id}`);
      if (["forum_topics", "forum_posts", "forum_post_comments"].includes(table)) {
        row.request_key = `dev-${table}-${row.id}`;
        row.request_hash = hash(row.request_key);
      }
      if (table === "forum_topics") {row.write_token = hash(`dev-write-${row.id}`);delete row.last_post_id;delete row.last_comment_id;}
      insert(table, row, table === "forum_topic_tags" ? "topic_id,tag_id" : "id");
    }
  }
  for(const topic of forum.forum_topics){
    // Complete cyclic references only for pristine seeded topics; preserve later edits.
    sql.push(`UPDATE forum_topics SET last_post_id=${quote(topic.last_post_id==null?null:topic.last_post_id+10000)},last_comment_id=${quote(topic.last_comment_id==null?null:topic.last_comment_id+10000)} WHERE id=${topic.id+10000} AND write_token=${quote(hash(`dev-write-${topic.id+10000}`))};`);
  }
  for (const user of [users.user, 10001, users.uploader]) insert("forum_post_likes", { post_id: 11000, user_id: user }, "post_id,user_id");
  for (const [id, status, target, targetId, post, comment] of [[10101, "resolved", "comment", 12003, 11001, 12003], [10102, "dismissed", "topic", 10102, null, null]]) {
    insert("forum_content_reports", { id, user_id: users.user, topic_id: target === "topic" ? targetId : 10100, post_id: post, comment_id: comment, target_kind: target, target_id: targetId, reason: "其他", explanation: "本地演示：已处理举报。", status, note: status === "resolved" ? "已隐藏相关内容" : "查看上下文后无需处理", resolved_by: users.admin, resolved_at: now, created_at: now });
  }
  return sql;
}
