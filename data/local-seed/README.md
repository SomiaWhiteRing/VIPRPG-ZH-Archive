# Fixed Local Seed

The direct inbox migration `0028_work_maintainer_direct_inbox.sql` removes obsolete
maintainer summary notices and their index, carrying read receipts to application
rows. The fixed seed schema and migration ledger include this migration.

The maintainer request migration `0027_work_maintainer_requests.sql` adds an empty
work-scoped application table, inbox references, and lifecycle triggers. The
fixed seed schema and migration ledger are synchronized; existing maintainers,
notifications, business records, and R2 objects are preserved.

The work editing refresh applies `0025_split_work_edit_permissions.sql` and
records it in the migration ledger. Work information and archive/external-link
editing have independent grants; only admin and super_admin retain these grants.
The wiki_editor and work_editor grants and shipped descriptions are updated.
Own-work maintenance, memberships, business records and R2 objects are preserved.

The appearance migration `0024_color_theme_preference.sql` adds the account
color theme with `light`, `dark`, and `system` choices. Existing accounts default
to system. The schema and migration ledger are synchronized; other preferences,
business rows, and R2 objects are preserved.

The face sheet uploader migration `0023_face_sheet_uploaders.sql` records each
verified uploader independently of content deduplication. Existing first uploaders
are backfilled; face sheets, bindings, and business rows are preserved. The schema
and migration ledger are synchronized.

The nested forum reply like migration `0022_forum_comment_likes.sql` adds an
empty per-user like relation and enables live nested reply targets for forum like
notifications. Existing inbox IDs, read/archive timestamps, role-event sources,
and all business rows are preserved. The schema and migration ledger are synchronized.

The download observability refresh applies `0020_download_observability.sql`.
Full and range responses, transport interruptions and server failures are counted
separately. Historical counters remain unclassified; completed response bytes and
R2 GET calls use the new observation counters. Later success retains the last
failure reason and timestamp. The schema and migration ledger are synchronized.

The personal emoji group migration `0021_face_emoji_groups.sql` adds empty
account-owned groups and many-to-many favorite assignment tables. Each favorite
can belong to multiple groups. Existing favorites, their order, immutable face
references, default emojis and published content remain unchanged. The fixed
seed keeps its group tables empty and synchronizes the schema and migration ledger.

The display-name refresh applies `0019_unique_user_display_names.sql` and records
it in the migration ledger. Active and disabled accounts have unique names under
SQLite NOCASE comparison; actual renames record their old and new names through
an atomic audit trigger. Existing account names and business rows are preserved.

The account permission refresh applies `0018_account_and_forum_permissions.sql`
and records it in the migration ledger. The base user role grants self-renaming
and forum use; the new per-user permission block table is empty. Existing
account names and business rows are preserved.

The game-card interaction preference refresh applies
`0016_game_card_interaction_preference.sql`. Existing and new accounts default to
showing interaction counts; the schema and migration ledger are synchronized.
Existing business records and R2 objects are preserved.

The comment reply refresh applies `0012_comment_reply_notifications.sql`,
adding a nullable inbox reference for replies on works, creators and characters.
The migration ledger is synchronized; existing records and R2 objects are preserved.

The uploaded-work comment preference refresh applies
`0011_uploaded_work_comment_notifications.sql` after 0010 and records it in the
migration ledger. All existing accounts default to receiving these notices.
Business rows and R2 objects are preserved; existing inbox items have no work
comment reference. No historical comment notifications are generated.

The consolidated `0006_tags_favorites_and_read_indexes.sql` preserves the original
execution order of the eight unpublished tag, favorite and bounded-read migrations.
The snapshot and local development ledger now contain 0001 through 0006.
Public tags use names as primary keys; favorite-bound user tags and anonymous
trigger-maintained usage statistics support tag discovery. Favorite notes allow
500 characters, and new favorite tags allow 10 names of up to 20 characters.
Read indexes cover favorite ordering, external-link availability, creator credits,
public comments and object references. Active-object scan indexes and an empty
GC cursor table bound cleanup candidate reads. Business records and R2 objects
are preserved. The applied 0001 through 0005 files remain unchanged.

The software package cleanup refresh applies `0005_tool_artifact_gc.sql`,
retaining all release/build identities while allowing scheduled reclamation of
superseded package objects. The seed schema and migration ledger include it;
existing business records and R2 objects are preserved.

The shared player refresh applies `0003_shared_archive_player.sql` after 0002,
adding the archive download policy projection and nullable tool CRC32 metadata.
All existing game snapshots, tool identities, business rows and R2 objects are
preserved; old archives keep `uses_shared_player=0`.

Production starts from the reviewed 0001 baseline; after initialization, applied migrations are immutable and upgrades use ordered incremental migrations. Seed restoration applies pending migrations after restoring the snapshot; clean seed preparation builds the complete migration chain and records its hashes. This development snapshot must never contain real production accounts or sessions. See [production operations](../../docs/production-deployment.md).

The 2026-09-26 account deletion refresh applies
`0002_account_deletion_email_challenge.sql` and records it after 0001 in the
migration ledger. It adds the `account_delete` email challenge purpose while
preserving all existing business records and R2 objects.

Work staff and tag relations include `sort_order`, matching the initialization
schema. Existing rows start at zero and retain their former name-based order
until edited. Table contents and the single initialization migration ledger are
preserved.

The current application list contains six roles: 管理员, 维基人, 维护作者信息,
维护角色信息, 维护作品信息 and 讨论版版主. All six require individual approval;
administrator requests are visible to and processed only by the bootstrap
administrator. The wiki role combines the three information-maintenance roles.
The existing creator_editor identity is retained and global access is closed.
Uploader applications are closed; its existing global setting and all individual
memberships are preserved. See [role definitions](../../docs/requestable-roles.md).
The roles schema permits administrator applications while prohibiting global
administrator grants. The single initialization migration ledger and unrelated
business tables are preserved.

Earlier snapshot changes:

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

The 2026-09-22 privacy refresh enables `users.profile_show_discussions` by
default, so all seven profile visibility settings now start enabled. Existing
account settings, all table contents and the single initialization migration
ledger are preserved.

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

The 2026-09-29 work genre refresh applies `0008_work_genre.sql` and records it
in the migration ledger. Fictional works 10001–10003 demonstrate Japanese,
Chinese and mixed free-form genre descriptions. Other records, including
accounts, sessions and R2 references, are preserved from the fixed seed.

The genre grouping refresh applies `0009_work_genre_groups.sql` and records it
in the migration ledger. The three existing spellings remain unchanged and
initially belong to separate groups. Public suggestion counts are backfilled;
the two built-in administrator roles receive `genre.manage`.
