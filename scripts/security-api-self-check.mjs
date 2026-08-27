import assert from "node:assert/strict";

const baseUrl = new URL(process.argv[2] ?? "http://localhost:3000");
const origin = baseUrl.origin;
const password = "dev123456789";

await expectStatus("anonymous protected GET", "/api/admin/summary", {}, 401);
await expectStatus(
  "anonymous same-origin mutation",
  "/api/imports",
  jsonRequest({}),
  401,
);
await expectStatus(
  "missing Origin",
  "/api/imports",
  jsonRequest({}, { origin: null }),
  403,
);

const [userCookie, uploaderCookie, adminCookie, rootCookie] = await Promise.all(
  [
    login("user@dev.local"),
    login("uploader@dev.local"),
    login("admin@dev.local"),
    login("super@dev.local"),
  ],
);
await expectStatus(
  "missing permission",
  "/api/imports",
  jsonRequest({}, { cookie: userCookie }),
  403,
);
await expectStatus(
  "bootstrap boundary",
  "/api/admin/permissions",
  { headers: { cookie: userCookie } },
  403,
);

const permissionModelResponse = await expectStatus(
  "root permission model",
  "/api/admin/permissions",
  { headers: { cookie: rootCookie } },
  200,
);
const permissionModel = await permissionModelResponse.json();
const uploaderRole = permissionModel.roles.find(
  (role) => role.key === "uploader",
);
assert.ok(uploaderRole, "seed uploader role");

const requestAccessResponse = await expectStatus(
  "user requests uploader role",
  "/api/account/request-upload-access",
  {
    method: "POST",
    headers: { cookie: userCookie, origin, accept: "application/json" },
  },
  200,
);
const requestAccessPayload = await requestAccessResponse.json();
const roleRequestId = requestAccessPayload.inboxItem.id;
assert.ok(Number.isSafeInteger(roleRequestId) && roleRequestId > 0);
const duplicateRequestResponse = await expectStatus(
  "duplicate role request reuses pending item",
  "/api/account/request-upload-access",
  {
    method: "POST",
    headers: { cookie: userCookie, origin, accept: "application/json" },
  },
  200,
);
assert.equal(
  (await duplicateRequestResponse.json()).inboxItem.id,
  roleRequestId,
);
await expectStatus(
  "approve role request",
  `/api/inbox/${roleRequestId}/resolve`,
  formRequest(
    { decision: "approve" },
    { cookie: adminCookie, acceptJson: true },
  ),
  200,
);
const approvedJobResponse = await expectStatus(
  "fresh permission context after approval",
  "/api/imports",
  jsonRequest(
    {
      sourceName: "role-request-job",
      sourceSizeBytes: 0,
      fileCount: 0,
      excludedFileCount: 0,
      excludedSizeBytes: 0,
      filePolicyVersion: "rpgm2000-2003-whitelist-v3",
    },
    { cookie: userCookie },
  ),
  201,
);
const approvedJob = await approvedJobResponse.json();
await expectStatus(
  "duplicate role approval",
  `/api/inbox/${roleRequestId}/resolve`,
  formRequest(
    { decision: "approve" },
    { cookie: adminCookie, acceptJson: true },
  ),
  409,
);
await expectStatus(
  "cleanup approved role-request job",
  `/api/imports/${approvedJob.importJob.id}/cancel`,
  { method: "POST", headers: { cookie: userCookie, origin } },
  200,
);
await expectStatus(
  "remove assigned uploader role",
  `/api/admin/users/4/roles/${uploaderRole.id}`,
  { method: "DELETE", headers: { cookie: adminCookie, origin } },
  200,
);
await expectStatus(
  "duplicate role removal",
  `/api/admin/users/4/roles/${uploaderRole.id}`,
  { method: "DELETE", headers: { cookie: adminCookie, origin } },
  409,
);
await expectStatus(
  "permission removed from current session",
  "/api/imports",
  jsonRequest({}, { cookie: userCookie }),
  403,
);

const createResponse = await expectStatus(
  "uploader creates owned job",
  "/api/imports",
  jsonRequest(
    {
      sourceName: "security-api-self-check",
      sourceSizeBytes: 0,
      fileCount: 0,
      excludedFileCount: 0,
      excludedSizeBytes: 0,
      filePolicyVersion: "rpgm2000-2003-whitelist-v3",
    },
    { cookie: uploaderCookie },
  ),
  201,
);
const createPayload = await createResponse.json();
const importJobId = createPayload.importJob.id;
assert.ok(Number.isSafeInteger(importJobId) && importJobId > 0);

await expectStatus(
  "removed import result route",
  `/api/imports/${importJobId}`,
  { headers: { cookie: uploaderCookie } },
  404,
);

await expectStatus(
  "object upload requires job",
  `/api/blobs/${"0".repeat(64)}`,
  {
    method: "PUT",
    headers: { cookie: uploaderCookie, origin },
    body: new Uint8Array(),
  },
  400,
);
await expectStatus(
  "cross-origin mutation",
  `/api/imports/${importJobId}/cancel`,
  {
    method: "POST",
    headers: { cookie: uploaderCookie, origin: "https://example.invalid" },
  },
  403,
);
await expectStatus(
  "admin cannot manage root",
  "/api/admin/users/1/status",
  formRequest(
    { status: "disabled" },
    { cookie: adminCookie, acceptJson: true },
  ),
  403,
);

await expectStatus(
  "published web play",
  "/api/archive-versions/3/web-play",
  {},
  200,
);
await expectStatus(
  "published media",
  "/api/media/blobs/8e20208635d8c539249d0299f9de321b85b43e89c90ba70b5ebbf5f4808d1038",
  {},
  200,
);

await expectStatus(
  "root disables lower user",
  "/api/admin/users/4/status",
  formRequest({ status: "disabled" }, { cookie: rootCookie, acceptJson: true }),
  200,
);
await expectStatus(
  "disabled session rejected",
  "/api/account/request-upload-access",
  { method: "POST", headers: { cookie: userCookie, origin } },
  401,
);
await expectStatus(
  "root re-enables lower user",
  "/api/admin/users/4/status",
  formRequest({ status: "active" }, { cookie: rootCookie, acceptJson: true }),
  200,
);

await expectStatus(
  "owner cancels job",
  `/api/imports/${importJobId}/cancel`,
  { method: "POST", headers: { cookie: uploaderCookie, origin } },
  200,
);
await expectStatus(
  "logout revokes current session",
  "/api/auth/logout",
  formRequest({ next: "/" }, { cookie: uploaderCookie }),
  303,
);
await expectStatus(
  "revoked session rejected",
  `/api/imports/${importJobId}/cancel`,
  { method: "POST", headers: { cookie: uploaderCookie, origin } },
  401,
);

console.log("API security self-check passed");

async function login(email) {
  const response = await fetch(new URL("/api/auth/login", baseUrl), {
    ...formRequest({ email, password, next: "/" }),
    redirect: "manual",
  });
  assert.equal(response.status, 303, `login status for ${email}`);
  const match = response.headers
    .get("set-cookie")
    ?.match(/viprpg_session=([A-Za-z0-9_-]{43})/);
  assert.ok(match, `opaque session cookie for ${email}`);
  return `viprpg_session=${match[1]}`;
}

async function expectStatus(label, path, init, expected) {
  const response = await fetch(new URL(path, baseUrl), {
    redirect: "manual",
    ...init,
  });
  if (response.status !== expected) {
    throw new Error(
      `${label}: expected ${expected}, received ${response.status}: ${await response.text()}`,
    );
  }
  return response;
}

function jsonRequest(body, options = {}) {
  const headers = { "content-type": "application/json" };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.origin !== null) headers.origin = options.origin ?? origin;
  return { method: "POST", headers, body: JSON.stringify(body) };
}

function formRequest(values, options = {}) {
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
    origin,
  };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.acceptJson) headers.accept = "application/json";
  return { method: "POST", headers, body: new URLSearchParams(values) };
}
