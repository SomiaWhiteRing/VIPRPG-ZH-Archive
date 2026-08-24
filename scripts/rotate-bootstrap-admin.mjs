import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWrangler } from "./run-wrangler.mjs";

const options = parseArgs(process.argv.slice(2));
const email = normalizeEmail(options.email);
const target = resolveTarget(options);
if (!target.local && options.confirm !== email) {
  throw new Error(`Remote rotation requires --confirm ${email}`);
}

const rotationKey = crypto.randomUUID();
const quotedEmail = sqlString(email);
const quotedRotationKey = sqlString(rotationKey);
const tempDir = mkdtempSync(join(tmpdir(), "viprpg-bootstrap-rotation-"));
const sqlPath = join(tempDir, "rotate.sql");

try {
  writeFileSync(sqlPath, `
BEGIN TRANSACTION;

UPDATE user_sessions
SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
WHERE user_id IN (
  SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
  WHERE r.kind = 'bootstrap_admin'
  UNION
  SELECT id FROM users WHERE email = ${quotedEmail}
);

INSERT INTO user_role_events (
  event_key, actor_user_id, target_user_id, action, role_id,
  role_key_snapshot, role_name_snapshot, reason
)
SELECT ${quotedRotationKey} || ':removed:' || ur.user_id, NULL, ur.user_id,
  'removed', r.id, r.key, r.name, 'bootstrap_admin_rotation'
FROM user_roles ur JOIN roles r ON r.id = ur.role_id
WHERE r.kind = 'bootstrap_admin';

DELETE FROM user_roles
WHERE role_id IN (SELECT id FROM roles WHERE kind = 'bootstrap_admin');

INSERT INTO user_roles (user_id, role_id)
VALUES (
  COALESCE((SELECT id FROM users
    WHERE email = ${quotedEmail} AND status = 'active' AND email_verified_at IS NOT NULL), 0),
  COALESCE((SELECT id FROM roles WHERE key = 'super_admin' AND kind = 'bootstrap_admin'), 0)
);

INSERT INTO user_role_events (
  event_key, actor_user_id, target_user_id, action, role_id,
  role_key_snapshot, role_name_snapshot, reason
)
SELECT ${quotedRotationKey} || ':assigned', NULL, u.id, 'assigned', r.id,
  r.key, r.name, 'bootstrap_admin_rotation'
FROM users u CROSS JOIN roles r
WHERE u.email = ${quotedEmail} AND r.key = 'super_admin';

INSERT INTO auth_audit_logs (user_id, email, event_type, detail_json)
SELECT u.id, u.email, 'bootstrap_admin_rotated', json_object(
  'rotationKey', ${quotedRotationKey},
  'targetEmail', u.email,
  'previousRootUserIds', (
    SELECT json_group_array(target_user_id) FROM user_role_events
    WHERE event_key LIKE ${quotedRotationKey} || ':removed:%'
  )
)
FROM users u WHERE u.email = ${quotedEmail};

COMMIT;
`, "utf8");

  await runWrangler(["d1", "execute", target.database, ...target.args, "--file", sqlPath]);
  console.log(`bootstrap admin rotated to ${email} on ${target.label}; all affected sessions revoked`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--local" || arg === "--staging" || arg === "--production") {
      result[arg.slice(2)] = true;
      continue;
    }
    if (arg === "--email" || arg === "--confirm") {
      result[arg.slice(2)] = args[++index];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function resolveTarget(options) {
  const modes = [options.local, options.staging, options.production].filter(Boolean);
  if (modes.length !== 1) throw new Error("Choose exactly one of --local, --staging, or --production");
  if (options.local) {
    return {
      local: true,
      label: "local D1",
      database: process.env.LOCAL_D1_DATABASE || "viprpg-archive-prod",
      args: ["--local"],
    };
  }
  if (options.staging) {
    return { local: false, label: "staging", database: "viprpg-archive-staging", args: ["--remote", "--env", "staging"] };
  }
  return { local: false, label: "production", database: "viprpg-archive-prod", args: ["--remote"] };
}

function normalizeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("--email must be a valid email address");
  return email;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
