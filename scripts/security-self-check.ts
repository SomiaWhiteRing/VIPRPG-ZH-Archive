import type { ArchiveUser } from "@/lib/dto/db/user-access";
import assert from "node:assert/strict";
import { sanitizeRedirectPath } from "../app/.server/auth/redirect";
import { getAppOrigin, normalizeAppOrigin } from "../app/.server/auth/config";
import { assertSameOrigin } from "../app/.server/auth/origin";
import { assertForumOrigin } from "../app/.server/forum/request";
import { createRuntime } from "../app/.server/runtime";
import { canManageUser } from "../app/.server/db/permissions";
import { canDeleteArchiveVersion } from "../lib/authz/archive-permissions";
import type { PermissionKey } from "../lib/authz/permissions";
import {
  PERMISSION_LIST,
  SYSTEM_ROLE_PERMISSIONS,
  hasPermission,
  isPermissionKey,
  parsePermissionKeys,
} from "../lib/authz/permissions";
import { isCustomRolePriority } from "../lib/authz/roles";

assert.equal(
  new Set(PERMISSION_LIST.map((permission) => permission.key)).size,
  PERMISSION_LIST.length,
);
assert.deepEqual(
  new Set(Object.keys(SYSTEM_ROLE_PERMISSIONS)),
  new Set(["user", "uploader", "admin", "super_admin"]),
);
for (const grants of Object.values(SYSTEM_ROLE_PERMISSIONS)) {
  for (const grant of grants) assert.equal(isPermissionKey(grant), true);
}
assert.equal(
  hasPermission(
    { status: "active", permissionKeys: ["import_job.create"] },
    "import_job.create",
  ),
  true,
);
assert.equal(
  hasPermission(
    { status: "disabled", permissionKeys: ["import_job.create"] },
    "import_job.create",
  ),
  false,
);
assert.deepEqual(parsePermissionKeys(["audit.read", "audit.read"]), [
  "audit.read",
]);
assert.deepEqual(
  new Set(
    parsePermissionKeys([
      "import_job.create",
      "archive_version.delete_own",
      "audit.read",
    ]),
  ),
  new Set(["import_job.create", "archive_version.delete_own", "audit.read"]),
);
assert.throws(() => parsePermissionKeys(["future.permission"]));
assert.equal(isCustomRolePriority(101), true);
assert.equal(isCustomRolePriority(699), true);
assert.equal(isCustomRolePriority(100), false);
assert.equal(isCustomRolePriority(700), false);

const actor = fakeUser(1, "active", 700, [
  "user.read",
  "archive_version.delete_any",
]);
const lowerUser = fakeUser(2, "active", 400, ["archive_version.delete_own"]);
const peerUser = fakeUser(3, "active", 700, []);
const disabledUser = fakeUser(4, "disabled", 100, []);
assert.equal(canManageUser(actor, lowerUser), true);
assert.equal(canManageUser(actor, peerUser), false);
assert.equal(canManageUser(actor, disabledUser), true);
assert.equal(canDeleteArchiveVersion(lowerUser, lowerUser.id), true);
assert.equal(canDeleteArchiveVersion(lowerUser, actor.id), false);
assert.equal(canDeleteArchiveVersion(actor, lowerUser.id), true);
assert.equal(sanitizeRedirectPath("/safe/path?next=1"), "/safe/path?next=1");
assert.equal(sanitizeRedirectPath("/\\evil.com"), "/");
assert.equal(sanitizeRedirectPath("/\u0000bad"), "/");

for (const configured of [
  "https://example.test",
  "https://example.test/",
  "  https://example.test/  ",
]) {
  const request = new Request("https://example.test/api/discussions", {
    method: "POST",
    headers: { origin: "https://example.test" },
  });
  const runtime = createRuntime(
    request,
    { APP_ORIGIN: configured } as CloudflareEnv,
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
  assert.equal(getAppOrigin(runtime), "https://example.test");
  assertSameOrigin(runtime, request);
  assertForumOrigin(runtime, request);
  const crossOrigin = new Request(request, {
    headers: { origin: "https://elsewhere.test" },
  });
  assert.throws(() => assertSameOrigin(runtime, crossOrigin));
  assert.throws(() => assertForumOrigin(runtime, crossOrigin), { status: 403 });
}
assert.equal(
  normalizeAppOrigin("http://localhost:3000/"),
  "http://localhost:3000",
);
assert.throws(() => normalizeAppOrigin("http://example.test"));
assert.throws(() => normalizeAppOrigin(" "));

console.log("security self-check passed");

function fakeUser(
  id: number,
  status: ArchiveUser["status"],
  maxRolePriority: number,
  permissionKeys: PermissionKey[],
): ArchiveUser {
  return {
    id,
    email: `${id}@example.test`,
    externalAuthId: `email:${id}@example.test`,
    displayName: `user-${id}`,
    avatarBlobSha256: null,
    bio: "",
    profileVisibility: {
      bio: true,
      favorites: true,
      history: true,
      catalogs: true,
      comments: true,
      discussions: true,
    },
    roleIds: [],
    roleKeys: [],
    roleNames: [],
    permissionKeys,
    maxRolePriority,
    isBootstrapAdmin: false,
    status,
    emailVerifiedAt: "2026-01-01",
    lastLoginAt: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}
