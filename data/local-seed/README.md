# Fixed Local Seed

The public creator editing refresh moves the fixed user/uploader grant into the
custom creator_editor role (作者资料编辑, priority 150). This role starts with
applications and global availability enabled, preserving the existing access
while allowing administrators to close global access or approve individuals.
Its only grant is creator.metadata.update_public. All existing roles, other
grants, memberships, events and the migration ledger are preserved.

The 2026-09-22 custom account role sync verifies the local definitions and all
16 grants for wiki_editor, dev_forum_curator and dev_retired_editor against this
snapshot. They are already preserved here. The staging seed now includes those
three custom roles and their grants, without copying development accounts,
sessions or user-role memberships. Built-in roles remain initialized by schema.

The 2026-09-22 role application refresh adds independent application and global
availability settings plus the effective-role view. Only uploader applications
are enabled initially; every role starts with global availability off. The
existing contents of all 80 tables, including individual role grants, role
events, inbox records and the single initialization migration ledger, are
preserved. Existing local databases are not rebuilt by this snapshot change.

Captured from the reviewed local D1 database and R2 bucket on 2026-09-16.
This snapshot is the source of truth for local initialization. It preserves
character IDs, names, aliases, categories, memberships, portrait cells, material
bindings, and all other database tables exactly as captured.

- `database.sqlite.gz`: complete SQLite online backup, including committed WAL data.
- `manifest.json`: capture timestamp, database hashes, table counts, R2 keys,
  asset paths, content hashes, sizes, and object metadata.
- `objects/`: R2 bytes not already present in the repository's character assets.

The captured database contains 930 characters, 132 categories, 925 memberships,
887 default portraits, 5,207 face sheets, and 11,958 other material records.
The R2 manifest contains 17,235 objects. All referenced asset files must be
included when sharing or committing the seed.

The 2026-09-20 partial refresh copies all eight local link cards, their rich text,
button settings, visibility and ordering, and adds five required icon objects.
Software release and artifact tables are empty; real installers are uploaded
through the root administrator resource panel and are not stored in Git.

The showcase schema refresh adds `users.showcase_revision` with an initial value
of zero and an empty `user_showcase_entries` table, preserving the captured
content and the single initialization migration ledger.
The showcase portrait refresh adds an optional `portrait_ref_id` linked to the
existing character portrait library, without changing captured content.
The showcase privacy refresh adds `users.profile_show_showcase`, enabled by
default. Empty showcases remain hidden on public profiles.

The 2026-09-21 creator refresh grants public creator editing to the four built-in
roles and replaces the single homepage column with an ordered `links_json`
array. The three existing homepages are retained as personal-website entries;
all six creators, unrelated table contents and the single initialization
migration ledger are preserved.

The 2026-09-21 work-source removal drops the `source` external-link type.
All seven captured external links and all 80 tables' contents, including the
single initialization migration ledger, are preserved.

Commands from the repository root:

```sh
npm run db:local:seed          # Restore into an empty local database
npm run db:local:seed:verify   # Verify SQLite and all referenced object bytes
npm run db:local:seed:capture  # Replace the seed with the current local state
```

Stop the local server before restoring. Pause editing and uploads before
capturing so the D1 and R2 snapshots describe the same state. Capture does not
modify the live database. Restore rejects an existing populated database.
This is a local development snapshot, including development accounts and session
tables; it is not a production initialization procedure.

See [local demo data](../../docs/local-demo-data.md) for accounts, recovery,
isolated state directories, and migration instructions.

The face emoji schema replaces the independent custom emoji catalogue with immutable face cells, account libraries, default selections and content references. Existing demonstration codes use approved face cells; the retired example is plain unavailable text. The 2026-09-20 partial refresh includes 30 default selections in their local order and their required immutable face references. The snapshot retains the single initialization migration and all unrelated business records.

The pinning schema refresh adds nullable `comments.pinned_at` and
`forum_topics.pinned_at`. All captured content starts unpinned; the single
initialization migration ledger is preserved.

The comment attachment refresh adds an empty `comment_images` table and nullable
comment publication request identities. The nine captured comments and all other
business records are preserved, with the single initialization migration ledger.

The 2026-09-21 password refresh rehashes the nine development accounts with the
current Workers-compatible scrypt policy. Their documented password and all other
captured fields remain unchanged. Staging initialization still excludes users.

The registration refresh adds nullable `email_verification_challenges.pending_display_name`
to match the current initialization schema, preserving all rows and the single
migration ledger.
