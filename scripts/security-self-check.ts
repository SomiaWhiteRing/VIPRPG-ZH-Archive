import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PERMISSION_LIST,
  SYSTEM_ROLE_PERMISSIONS,
  hasPermission,
  isPermissionKey,
  parsePermissionKeys,
} from "../lib/authz/permissions";
import { isCustomRolePriority } from "../lib/authz/roles";
import { buildInboxVisibilityClause } from "../lib/server/db/inbox";
import { canManageUser } from "../lib/server/db/permissions";
import { canDeleteArchiveVersion } from "../lib/server/db/archive-maintenance";
import type { PermissionKey } from "../lib/authz/permissions";
import type { ArchiveUser } from "../lib/server/db/users";

assert.equal(new Set(PERMISSION_LIST.map((permission) => permission.key)).size, PERMISSION_LIST.length);
assert.deepEqual(Object.keys(SYSTEM_ROLE_PERMISSIONS), ["user", "uploader", "admin", "super_admin"]);
for (const grants of Object.values(SYSTEM_ROLE_PERMISSIONS)) {
  for (const grant of grants) assert.equal(isPermissionKey(grant), true);
}
assert.equal(hasPermission({ status: "active", permissionKeys: ["import_job.create"] }, "import_job.create"), true);
assert.equal(hasPermission({ status: "disabled", permissionKeys: ["import_job.create"] }, "import_job.create"), false);
assert.deepEqual(parsePermissionKeys(["audit.read", "audit.read"]), ["audit.read"]);
assert.deepEqual(
  new Set(parsePermissionKeys(["import_job.create", "archive_version.delete_own", "audit.read"])),
  new Set(["import_job.create", "archive_version.delete_own", "audit.read"]),
);
assert.throws(() => parsePermissionKeys(["future.permission"]), /Unknown permission key/);
assert.equal(isCustomRolePriority(101), true);
assert.equal(isCustomRolePriority(699), true);
assert.equal(isCustomRolePriority(100), false);
assert.equal(isCustomRolePriority(700), false);

const actor = fakeUser(1, "active", 700, ["user.read", "archive_version.delete_any"]);
const lowerUser = fakeUser(2, "active", 400, ["archive_version.delete_own"]);
const peerUser = fakeUser(3, "active", 700, []);
const disabledUser = fakeUser(4, "disabled", 100, []);
assert.equal(canManageUser(actor, lowerUser), true);
assert.equal(canManageUser(actor, peerUser), false);
assert.equal(canManageUser(actor, disabledUser), true);
assert.equal(canDeleteArchiveVersion(lowerUser, lowerUser.id), true);
assert.equal(canDeleteArchiveVersion(lowerUser, actor.id), false);
assert.equal(canDeleteArchiveVersion(actor, lowerUser.id), true);

const inboxVisibility = buildInboxVisibilityClause(["user.role.assign"]);
assert.match(inboxVisibility.sql, /required_permission_key IN/);

const migration = readFileSync(new URL("../migrations/0001_init_archive_schema.sql", import.meta.url), "utf8");
assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS permissions/);
assert.doesNotMatch(migration, /permission_id|system_role_kind|old_role_|new_role_/);
assert.match(migration, /user_roles_unique_bootstrap_admin/);
assert.match(migration, /user_roles_protect_base_role/);
assert.match(migration, /roles_protect_delete/);
assert.match(migration, /event_key TEXT NOT NULL UNIQUE/);
for (const permission of Object.values(SYSTEM_ROLE_PERMISSIONS).flat()) {
  assert.match(migration, new RegExp(`"${permission.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
}

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
  };
}
