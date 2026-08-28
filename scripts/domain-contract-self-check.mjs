import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWrangler } from "./run-wrangler.mjs";

const baseUrl = new URL(process.argv[2] ?? "http://localhost:3000");
const origin = baseUrl.origin;
const database = process.env.LOCAL_D1_DATABASE || "viprpg-archive-prod";
const password = process.env.DOMAIN_CHECK_PASSWORD || "dev123456789";
const relationMarker = "domain-contract-self-check";
const testOrder = 987_000_000 + (Date.now() % 100_000);
const catalogTitle = `领域契约自检目录 ${process.pid}-${Date.now().toString(36)}`;
const fixtureOriginalId = 900_000_000 + ((Date.now() + process.pid) % 100_000);
const fixtureTranslationAId = fixtureOriginalId + 1;
const fixtureTranslationBId = fixtureOriginalId + 2;
const fixtureOriginalBId = fixtureOriginalId + 3;
const fixtureTranslationCId = fixtureOriginalId + 4;
const fixtureIds = [fixtureOriginalId, fixtureTranslationAId, fixtureTranslationBId, fixtureOriginalBId, fixtureTranslationCId];
const externalWorkIds = [];
const externalMarker = `External Contract ${process.pid}-${Date.now().toString(36)}`;
const tempDir = mkdtempSync(join(tmpdir(), "viprpg-domain-contract-"));

const ordinaryCases = [
  [1, 2, "adaptation", "adaptation"],
  [1, 4, "prequel", "sequel"],
  [1, 5, "sequel", "prequel"],
  [1, 6, "same_setting", "same_setting"],
  [2, 3, "alternative_setting", "alternative_setting"],
  [2, 4, "alternative_version", "alternative_version"],
  [2, 5, "character", "character"],
  [2, 6, "collaboration", null],
  [3, 4, "version", "main_version"],
  [3, 6, "main_version", "version"],
  [4, 5, "collection", "in_collection"],
  [4, 6, "in_collection", "collection"],
];

const createdRelationIds = [];
let collaborationReverseId = null;
const translationIds = [];
let catalogId = null;
let uploaderCookie;
let userCookie;

try {
  await cleanupLocalState();
  await createTranslationFixture();
  uploaderCookie = await login("uploader@dev.local");
  userCookie = await login("user@dev.local");
  await runExternalWorkChecks();

  for (const [fromWorkId, toWorkId, relationType] of ordinaryCases) {
    const response = await expectStatus(
      `create ${relationType}`,
      `/api/works/${fromWorkId}/relations`,
      jsonRequest({ targetWorkId: toWorkId, relationType, relationOrder: testOrder, notes: relationMarker }, uploaderCookie),
      201,
    );
    const payload = await response.json();
    assert.ok(Number.isSafeInteger(payload.id) && payload.id > 0, `${relationType} returned an id`);
    createdRelationIds.push(payload.id);
  }

  await assertD1("ordinary inverse mapping", ordinaryCases.map(([fromWorkId, toWorkId, relationType]) => ({
    name: `${relationType} source`,
    condition: `(
      SELECT COUNT(*) FROM work_relations
      WHERE from_work_id=${fromWorkId} AND to_work_id=${toWorkId}
        AND relation_type='${relationType}' AND vice_versa=0
        AND relation_order=${testOrder} AND notes='${relationMarker}'
    ) = 1`,
  })).concat(ordinaryCases.filter(([, , , inverseType]) => inverseType).map(([fromWorkId, toWorkId, , inverseType]) => ({
    name: `${inverseType} inverse`,
    condition: `(
      SELECT COUNT(*) FROM work_relations
      WHERE from_work_id=${toWorkId} AND to_work_id=${fromWorkId}
        AND relation_type='${inverseType}' AND vice_versa=1
        AND relation_order=${testOrder} AND notes='${relationMarker}'
    ) = 1`,
  }))));

  const duplicateResponse = await expectStatus(
    "duplicate ordinary relation",
    "/api/works/1/relations",
    jsonRequest({ targetWorkId: 2, relationType: "adaptation" }, uploaderCookie),
    409,
  );
  assert.match(await duplicateResponse.text(), /关联|relation/i);

  const conflictingRelationResponse = await expectStatus(
    "create relation used by type-conflict check",
    "/api/works/1/relations",
    jsonRequest({ targetWorkId: 2, relationType: "same_setting", relationOrder: testOrder, notes: relationMarker }, uploaderCookie),
    201,
  );
  const conflictingRelationId = (await conflictingRelationResponse.json()).id;
  assert.ok(Number.isSafeInteger(conflictingRelationId) && conflictingRelationId > 0, "conflicting relation returned an id");
  createdRelationIds.push(conflictingRelationId);
  await expectStatus(
    "ordinary relation type conflict",
    `/api/work-relations/${conflictingRelationId}`,
    jsonMutation("PATCH", { relationType: "adaptation" }, uploaderCookie),
    409,
  );
  await expectStatus(
    "cleanup relation used by type-conflict check",
    `/api/work-relations/${conflictingRelationId}`,
    mutationRequest("DELETE", uploaderCookie),
    200,
  );
  createdRelationIds.pop();

  await expectStatus(
    "non-owner ordinary relation deletion rejected",
    `/api/work-relations/${createdRelationIds[0]}`,
    mutationRequest("DELETE", userCookie),
    403,
  );
  await expectStatus(
    "delete ordinary relation removes its inverse",
    `/api/work-relations/${createdRelationIds[0]}`,
    mutationRequest("DELETE", uploaderCookie),
    200,
  );
  await assertD1("ordinary pair deletion", [{
    name: "adaptation pair removed",
    condition: "(SELECT COUNT(*) FROM work_relations WHERE (from_work_id=1 AND to_work_id=2) OR (from_work_id=2 AND to_work_id=1)) = 0",
  }]);
  createdRelationIds.shift();

  const collaborationIndex = ordinaryCases.findIndex(([, , type]) => type === "collaboration");
  const collaborationSourceId = createdRelationIds[collaborationIndex - 1];
  const collaborationReverseResponse = await expectStatus(
    "collaboration allows an explicit reverse row",
    "/api/works/6/relations",
    jsonRequest({ targetWorkId: 2, relationType: "collaboration", relationOrder: testOrder, notes: `${relationMarker}-reverse` }, uploaderCookie),
    201,
  );
  collaborationReverseId = (await collaborationReverseResponse.json()).id;
  assert.ok(Number.isSafeInteger(collaborationReverseId) && collaborationReverseId > 0, "collaboration reverse returned an id");
  await assertD1("collaboration is one-way", [
    {
      name: "collaboration has no generated inverse",
      condition: "(SELECT COUNT(*) FROM work_relations WHERE from_work_id=2 AND to_work_id=6 AND notes='domain-contract-self-check') = 1",
    },
    {
      name: "collaboration explicit reverse remains distinct",
      condition: "(SELECT COUNT(*) FROM work_relations WHERE from_work_id=6 AND to_work_id=2 AND notes='domain-contract-self-check-reverse' AND vice_versa=0) = 1",
    },
  ]);
  await expectStatus(
    "delete collaboration relation",
    `/api/work-relations/${collaborationSourceId}`,
    mutationRequest("DELETE", uploaderCookie),
    200,
  );
  await assertD1("collaboration deletion", [{
    name: "collaboration source row removed only",
    condition: "(SELECT COUNT(*) FROM work_relations WHERE from_work_id=2 AND to_work_id=6) = 0 AND (SELECT COUNT(*) FROM work_relations WHERE from_work_id=6 AND to_work_id=2 AND vice_versa=0) = 1",
  }]);
  createdRelationIds.splice(collaborationIndex - 1, 1);
  await expectStatus("delete explicit collaboration reverse", `/api/work-relations/${collaborationReverseId}`, mutationRequest("DELETE", uploaderCookie), 200);
  collaborationReverseId = null;
  await assertD1("collaboration reverse cleanup", [{
    name: "collaboration rows removed independently",
    condition: "(SELECT COUNT(*) FROM work_relations WHERE (from_work_id=2 AND to_work_id=6) OR (from_work_id=6 AND to_work_id=2)) = 0",
  }]);

  const translationResponse = await expectStatus(
    "create parallel translation",
    `/api/works/${fixtureOriginalId}/translation-relations`,
    jsonRequest({ targetRole: "translation", targetWorkId: fixtureTranslationAId }, uploaderCookie),
    201,
  );
  const translationPayload = await translationResponse.json();
  translationIds.push(translationPayload.id);
  assert.ok(Number.isSafeInteger(translationPayload.id) && translationPayload.id > 0, "translation returned an id");
  const secondTranslationResponse = await expectStatus(
    "create second parallel translation",
    `/api/works/${fixtureOriginalId}/translation-relations`,
    jsonRequest({ targetRole: "translation", targetWorkId: fixtureTranslationBId }, uploaderCookie),
    201,
  );
  const secondTranslationId = (await secondTranslationResponse.json()).id;
  translationIds.push(secondTranslationId);
  assert.ok(Number.isSafeInteger(secondTranslationId) && secondTranslationId > 0, "second translation returned an id");
  const thirdTranslationResponse = await expectStatus(
    "create third parallel translation",
    `/api/works/${fixtureOriginalId}/translation-relations`,
    jsonRequest({ targetRole: "translation", targetWorkId: fixtureTranslationCId }, uploaderCookie),
    201,
  );
  const thirdTranslationId = (await thirdTranslationResponse.json()).id;
  translationIds.push(thirdTranslationId);
  assert.ok(Number.isSafeInteger(thirdTranslationId) && thirdTranslationId > 0, "third translation returned an id");

  await assertD1("translation pair and parallel translations", [
    {
      name: "translation source row",
      condition: `(SELECT COUNT(*) FROM translation_relations WHERE source_work_id=${fixtureOriginalId} AND target_work_id=${fixtureTranslationAId} AND target_role='translation' AND vice_versa=0 AND relation_order=0) = 1`,
    },
    {
      name: "translation inverse row",
      condition: `(SELECT COUNT(*) FROM translation_relations WHERE source_work_id=${fixtureTranslationAId} AND target_work_id=${fixtureOriginalId} AND target_role='original' AND vice_versa=1 AND relation_order=0) = 1`,
    },
    {
      name: "all parallel translations visible from original",
      condition: `(SELECT COUNT(*) FROM translation_relations WHERE source_work_id=${fixtureOriginalId} AND target_role='translation' AND target_work_id IN (${fixtureTranslationAId},${fixtureTranslationBId},${fixtureTranslationCId})) = 3`,
    },
  ]);

  await expectStatus(
    "translation source ordering",
    `/api/translation-relations/${secondTranslationId}`,
    jsonMutation("PATCH", { direction: -1 }, uploaderCookie),
    200,
  );
  await assertD1("translation source ordering is independent", [
    {
      name: "source order moved one position",
      condition: `(SELECT GROUP_CONCAT(target_work_id, ',') FROM (SELECT target_work_id FROM translation_relations WHERE source_work_id=${fixtureOriginalId} AND vice_versa=0 ORDER BY relation_order,id)) = '${fixtureTranslationBId},${fixtureTranslationAId},${fixtureTranslationCId}'`,
    },
    {
      name: "inverse order unchanged",
      condition: `(SELECT relation_order FROM translation_relations WHERE source_work_id=${fixtureTranslationBId} AND target_work_id=${fixtureOriginalId} AND vice_versa=1) = 0`,
    },
  ]);
  await expectStatus(
    "translation second move remains adjacent",
    `/api/translation-relations/${thirdTranslationId}`,
    jsonMutation("PATCH", { direction: -1 }, uploaderCookie),
    200,
  );
  await assertD1("translation repeated ordering", [{
    name: "repeated move swaps adjacent rows",
    condition: `(SELECT GROUP_CONCAT(target_work_id, ',') FROM (SELECT target_work_id FROM translation_relations WHERE source_work_id=${fixtureOriginalId} AND vice_versa=0 ORDER BY relation_order,id)) = '${fixtureTranslationBId},${fixtureTranslationCId},${fixtureTranslationAId}'`,
  }]);
  await expectStatus(
    "translation downward move",
    `/api/translation-relations/${thirdTranslationId}`,
    jsonMutation("PATCH", { direction: 1 }, uploaderCookie),
    200,
  );
  await assertD1("translation downward move swaps adjacent rows", [{
    name: "downward move is adjacent",
    condition: `(SELECT GROUP_CONCAT(target_work_id, ',') FROM (SELECT target_work_id FROM translation_relations WHERE source_work_id=${fixtureOriginalId} AND vice_versa=0 ORDER BY relation_order,id)) = '${fixtureTranslationBId},${fixtureTranslationAId},${fixtureTranslationCId}'`,
  }]);

  const detailResponse = await expectStatus("translation detail page", `/games/${fixtureOriginalId}`, {}, 200);
  const detailHtml = await detailResponse.text();
  assert.match(detailHtml, /领域契约译本 A/, "first translation is shown");
  assert.match(detailHtml, /领域契约译本 B/, "parallel translation is shown");
  assert.match(detailHtml, /领域契约译本 C/, "third parallel translation is shown");

  await expectStatus(
    "translation self association rejected",
    `/api/works/${fixtureOriginalId}/translation-relations`,
    jsonRequest({ targetRole: "translation", targetWorkId: fixtureOriginalId }, uploaderCookie),
    400,
  );
  await expectStatus(
    "same-language translation rejected",
    `/api/works/${fixtureOriginalId}/translation-relations`,
    jsonRequest({ targetRole: "translation", targetWorkId: 3 }, uploaderCookie),
    400,
  );
  await expectStatus(
    "translation role conflict rejected",
    `/api/works/${fixtureOriginalId}/translation-relations`,
    jsonRequest({ targetRole: "original", targetWorkId: fixtureTranslationAId }, uploaderCookie),
    400,
  );
  await expectStatus(
    "translation cannot choose a second original",
    `/api/works/${fixtureTranslationAId}/translation-relations`,
    jsonRequest({ targetRole: "original", targetWorkId: fixtureOriginalBId }, uploaderCookie),
    409,
  );
  await expectStatus(
    "duplicate translation pair rejected",
    `/api/works/${fixtureOriginalId}/translation-relations`,
    jsonRequest({ targetRole: "translation", targetWorkId: fixtureTranslationAId }, uploaderCookie),
    409,
  );

  await expectStatus(
    "non-owner translation deletion rejected",
    `/api/translation-relations/${translationIds[0]}`,
    mutationRequest("DELETE", userCookie),
    403,
  );
  await expectStatus(
    "delete translation relation removes its inverse",
    `/api/translation-relations/${translationIds[0]}`,
    mutationRequest("DELETE", uploaderCookie),
    200,
  );
  await assertD1("translation pair deletion", [{
    name: "translation pair removed",
    condition: `(SELECT COUNT(*) FROM translation_relations WHERE (source_work_id=${fixtureOriginalId} AND target_work_id=${fixtureTranslationAId}) OR (source_work_id=${fixtureTranslationAId} AND target_work_id=${fixtureOriginalId})) = 0`,
  }]);
  translationIds.shift();
  for (const translationId of [...translationIds]) {
    await expectStatus("delete remaining translation relation", `/api/translation-relations/${translationId}`, mutationRequest("DELETE", uploaderCookie), 200);
  }
  translationIds.length = 0;

  const catalogResponse = await expectStatus(
    "catalog creation",
    "/api/catalogs",
    jsonRequest({ title: catalogTitle, description: "temporary domain contract check" }, uploaderCookie),
    201,
  );
  const catalogPayload = await catalogResponse.json();
  catalogId = catalogPayload.catalog?.id;
  assert.ok(Number.isSafeInteger(catalogId) && catalogId > 0, "catalog returned an id");

  for (const [workId, note] of [[5, "first"], [4, "second"], [2, "third"]]) {
    await expectStatus(
      "catalog single item add",
      `/api/catalogs/${catalogId}/items`,
      jsonRequest({ workId, note }, uploaderCookie),
      200,
    );
  }
  const orderResponse = await expectStatus(
    "catalog explicit ordering",
    `/api/catalogs/${catalogId}/items`,
    jsonMutation("PATCH", { items: [{ workId: 5, sortOrder: 10, note: "first" }, { workId: 4, sortOrder: -1, note: "second" }, { workId: 2, sortOrder: 0, note: "third" }] }, uploaderCookie),
    200,
  );
  const orderPayload = await orderResponse.json();
  assert.deepEqual(orderPayload.catalog.items.map((item) => item.workId), [4, 2, 5], "catalog keeps explicit sort order");

  await assertD1("catalog owner and ordering", [
    {
      name: "catalog owner",
      condition: `(SELECT owner_user_id FROM catalogs WHERE id=${catalogId} AND title='${catalogTitle}') = 3`,
    },
    {
      name: "catalog sort order",
      condition: `(SELECT GROUP_CONCAT(work_id, ',') FROM (SELECT work_id FROM catalog_items WHERE catalog_id=${catalogId} ORDER BY sort_order,work_id)) = '4,2,5'`,
    },
  ]);

  await expectStatus(
    "non-owner catalog update rejected",
    `/api/catalogs/${catalogId}`,
    jsonMutation("PATCH", { title: "越权修改" }, userCookie),
    403,
  );
  await expectStatus(
    "non-owner catalog reorder rejected",
    `/api/catalogs/${catalogId}/items`,
    jsonMutation("PATCH", { items: [{ workId: 2, sortOrder: 0 }] }, userCookie),
    403,
  );
  await expectStatus(
    "non-owner catalog item deletion rejected",
    `/api/catalogs/${catalogId}/items?workId=5`,
    mutationRequest("DELETE", userCookie),
    403,
  );

  const removeItemResponse = await expectStatus(
    "owner removes catalog item",
    `/api/catalogs/${catalogId}/items?workId=4`,
    mutationRequest("DELETE", uploaderCookie),
    200,
  );
  const removeItemPayload = await removeItemResponse.json();
  assert.deepEqual(removeItemPayload.catalog.items.map((item) => item.workId), [2, 5], "catalog item removal preserves remaining order");

  await expectStatus("catalog deletion", `/api/catalogs/${catalogId}`, mutationRequest("DELETE", uploaderCookie), 200);
  catalogId = null;

  console.log("Domain contract self-check passed");
} finally {
  try {
    for (const translationId of translationIds) {
      if (uploaderCookie) {
        try { await expectStatus("cleanup translation", `/api/translation-relations/${translationId}`, mutationRequest("DELETE", uploaderCookie), 200); } catch {}
      }
    }
  } catch {}
  try {
    if (catalogId !== null && uploaderCookie) {
      await expectStatus("cleanup catalog", `/api/catalogs/${catalogId}`, mutationRequest("DELETE", uploaderCookie), 200);
    }
  } catch {}
  for (const relationId of createdRelationIds) {
    if (uploaderCookie) {
      try { await expectStatus("cleanup relation", `/api/work-relations/${relationId}`, mutationRequest("DELETE", uploaderCookie), 200); } catch {}
    }
  }
  if (collaborationReverseId !== null && uploaderCookie) {
    try { await expectStatus("cleanup collaboration reverse", `/api/work-relations/${collaborationReverseId}`, mutationRequest("DELETE", uploaderCookie), 200); } catch {}
  }
  try {
    if (externalWorkIds.length) {
      await executeLocalSql(
        `DELETE FROM works WHERE id IN (${externalWorkIds.join(",")})`,
        "cleanup external work state",
      );
    }
    await cleanupLocalState();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function login(email) {
  const response = await fetch(new URL("/api/auth/login", baseUrl), {
    ...formRequest({ email, password }),
    redirect: "manual",
  });
  assert.equal(response.status, 303, `login status for ${email}`);
  const match = response.headers.get("set-cookie")?.match(/viprpg_session=([A-Za-z0-9_-]{43})/);
  assert.ok(match, `opaque session cookie for ${email}`);
  return `viprpg_session=${match[1]}`;
}

async function runExternalWorkChecks() {
  const engines = [
    "rpg_maker_xp",
    "rpg_maker_vx",
    "rpg_maker_vx_ace",
    "rpg_maker_mv",
    "rpg_maker_mz",
    "rpg_maker_unite",
    "mixed",
    "unknown",
    "other",
  ];
  for (const [index, engineFamily] of engines.entries()) {
    const response = await expectStatus(
      `external work ${engineFamily}`,
      "/api/works/external",
      externalWorkRequest({
        originalTitle: `${externalMarker} ${index}`,
        engineFamily,
      }, `https://example.com/${engineFamily}.zip`),
      201,
    );
    const payload = await response.json();
    assert.ok(Number.isSafeInteger(payload.workId) && payload.workId > 0, `${engineFamily} returned a work id`);
    externalWorkIds.push(payload.workId);
  }

  const externalPage = await fetch(new URL(`/games/${externalWorkIds[0]}`, baseUrl));
  const externalHtml = await externalPage.text();
  assert.equal(externalPage.status, 200, "external work page is public");
  assert.match(externalHtml, /外部下载/);
  assert.match(externalHtml, /该作品的文件由外部网站提供/);
  assert.doesNotMatch(externalHtml, /在线游玩/);

  await expectStatus(
    "2k external work rejected",
    "/api/works/external",
    externalWorkRequest({ originalTitle: `${externalMarker} invalid-2k`, engineFamily: "rpg_maker_2003" }, "https://example.com/2k.zip"),
    400,
  );
  await expectStatus(
    "external work without cover rejected",
    "/api/works/external",
    externalWorkRequest({ originalTitle: `${externalMarker} invalid-cover`, engineFamily: "rpg_maker_xp" }, "https://example.com/no-cover.zip", false),
    400,
  );
  await expectStatus(
    "external work invalid URL rejected",
    "/api/works/external",
    externalWorkRequest({ originalTitle: `${externalMarker} invalid-url`, engineFamily: "rpg_maker_xp" }, "javascript:alert(1)"),
    400,
  );
  await assertD1("external work distribution", [
    {
      name: "external work has no archive",
      condition: `(SELECT COUNT(*) FROM archive_versions WHERE work_id=${externalWorkIds[0]}) = 0`,
    },
    {
      name: "external work has one download link",
      condition: `(SELECT COUNT(*) FROM work_external_links WHERE work_id=${externalWorkIds[0]} AND link_type='download_page') = 1`,
    },
    {
      name: "external work published",
      condition: `(SELECT status FROM works WHERE id=${externalWorkIds[0]}) = 'published'`,
    },
  ]);
}

async function expectStatus(label, path, init, expected) {
  const response = await fetch(new URL(path, baseUrl), { redirect: "manual", ...init });
  if (response.status !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${response.status}: ${await response.text()}`);
  }
  return response;
}

async function assertD1(label, assertions) {
  const statements = [
    "DROP TABLE IF EXISTS _domain_contract_assertions",
    "CREATE TABLE _domain_contract_assertions (label TEXT PRIMARY KEY, value INTEGER NOT NULL CHECK (value = 1))",
    ...assertions.map(({ name, condition }) => `INSERT INTO _domain_contract_assertions(label,value) SELECT '${sqlQuote(name)}',CASE WHEN ${condition} THEN 1 ELSE 0 END`),
    "DROP TABLE _domain_contract_assertions",
  ];
  try {
    await executeLocalSql(`${statements.join(";\n")};`, label);
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function cleanupLocalState() {
  await executeLocalSql(`
DROP TABLE IF EXISTS _domain_contract_assertions;
DELETE FROM work_relations WHERE notes='${relationMarker}';
DELETE FROM work_relations WHERE notes='${relationMarker}-reverse';
DELETE FROM translation_relations WHERE created_by_user_id=3 AND ((source_work_id IN (${fixtureIds.join(",")}) AND target_work_id IN (${fixtureIds.join(",")})) OR relation_order IN (${testOrder},${testOrder + 1}));
DELETE FROM catalogs WHERE owner_user_id=3 AND title LIKE '领域契约自检目录 %';
DELETE FROM works WHERE created_by_user_id=3 AND original_title LIKE 'Domain Contract %';
DELETE FROM works WHERE id IN (${fixtureIds.join(",")});
`, "cleanup domain contract state");
}

async function createTranslationFixture() {
  await executeLocalSql(`
INSERT INTO works (id,original_title,chinese_title,is_original,language,status,created_by_user_id,published_at)
VALUES
  (${fixtureOriginalId},'Domain Contract Original','领域契约原版',0,'ja','published',3,CURRENT_TIMESTAMP),
  (${fixtureTranslationAId},'Domain Contract Translation A','领域契约译本 A',0,'zh-CN','published',3,CURRENT_TIMESTAMP),
  (${fixtureTranslationBId},'Domain Contract Translation B','领域契约译本 B',0,'en','published',3,CURRENT_TIMESTAMP),
  (${fixtureOriginalBId},'Domain Contract Original B','领域契约原版 B',0,'ja','published',3,CURRENT_TIMESTAMP),
  (${fixtureTranslationCId},'Domain Contract Translation C','领域契约译本 C',0,'ko','published',3,CURRENT_TIMESTAMP);
INSERT INTO work_uploaders (work_id,user_id) VALUES
  (${fixtureOriginalId},3),(${fixtureTranslationAId},3),(${fixtureTranslationBId},3),(${fixtureOriginalBId},3),(${fixtureTranslationCId},3);
INSERT INTO work_external_links (work_id,label,url,link_type) VALUES
  (${fixtureOriginalId},'外部下载','https://example.com/domain-original','download_page'),
  (${fixtureTranslationAId},'外部下载','https://example.com/domain-translation-a','download_page'),
  (${fixtureTranslationBId},'外部下载','https://example.com/domain-translation-b','download_page'),
  (${fixtureOriginalBId},'外部下载','https://example.com/domain-original-b','download_page'),
  (${fixtureTranslationCId},'外部下载','https://example.com/domain-translation-c','download_page');
`, "create translation fixture");
}

async function executeLocalSql(sql, label) {
  const file = join(tempDir, `${label.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}.sql`);
  writeFileSync(file, sql, "utf8");
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await runWrangler(["d1", "execute", database, "--local", "--file", file]);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 4) throw error;
      // ponytail: Wrangler collapses SQLite_BUSY diagnostics; bounded retries cover
      // the transient lock window without hiding a persistent SQL failure.
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
  throw lastError;
}

function jsonRequest(body, cookie) {
  return jsonMutation("POST", body, cookie);
}

function externalWorkRequest(metadata, downloadUrl, includeCover = true) {
  const form = new FormData();
  form.set("metadata", JSON.stringify({
    ...metadata,
    isOriginal: false,
    language: "zh-CN",
    aliases: [],
    tags: [],
    characters: [],
  }));
  form.set("download_url", downloadUrl);
  if (includeCover) {
    form.set("cover", new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }));
  }
  return { method: "POST", headers: { origin, cookie: uploaderCookie }, body: form };
}

function jsonMutation(method, body, cookie) {
  return {
    method,
    headers: { "content-type": "application/json", origin, cookie },
    body: JSON.stringify(body),
  };
}

function mutationRequest(method, cookie) {
  return { method, headers: { origin, cookie } };
}

function formRequest(values) {
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: new URLSearchParams({ ...values, next: "/" }),
  };
}

function sqlQuote(value) {
  return String(value).replaceAll("'", "''");
}
