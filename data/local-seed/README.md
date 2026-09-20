# Fixed Local Seed

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
