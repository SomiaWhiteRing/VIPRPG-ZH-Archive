# UX Rebuild Brief

The product needs more than a visual reskin. Current interaction patterns should be rebuilt around user tasks while preserving system capabilities.

## Product Principle

Do not expose the database/application shape as the primary user experience. Users should not see a flat pile of health checks, admin links, upload links, browsing links, and download tables unless they are in an admin console.

Organize the app around intent:

- Find a game.
- Understand whether it can be played or downloaded.
- Inspect release/archive history.
- Contribute or upload a game archive.
- Track upload/import progress.
- Read account messages and permissions.
- Administer content, users, storage, and maintenance.

## Required Preservation Discipline

Before any broad UX rewrite, create a preservation map:

| Existing item | Current route/file | User intent | New location | Dependency | Verification |
| --- | --- | --- | --- | --- | --- |
| Example: download ZIP | `/api/archive-versions/.../download` from home/detail | Player gets archive | Work detail primary action | current archive record | Click download link exists |

Every existing capability in scope must either:

- move to a clearer location;
- remain where it is for now;
- be removed only with explicit maintainer approval.

## Roles

Visitor/player:

- Browse works, creators, characters, tags, and series.
- Search/filter catalogues.
- Open a work detail page.
- Play in browser when supported.
- Download ZIP when available.

Logged-in user:

- See account state and inbox.
- Request uploader permission.
- Continue visible tasks started earlier.

Uploader:

- Start import/upload.
- Validate archive metadata.
- Track background upload/import tasks.
- Recover from errors and resume/cancel when supported.

Admin/super-admin:

- Review and edit works, creators, characters, series, tags, releases, archive versions, users, audit, storage health, and maintenance tasks.
- See dangerous actions isolated from routine actions.

## Suggested Information Architecture

Public shell:

- Home: festival/archive entrance, search, featured/current downloads, latest additions, clear primary links.
- Games: searchable catalogue with filters and cards.
- Work detail: canonical place for play/download, release history, archive versions, screenshots, creators, tags, series.
- Directories: creators, characters, tags, series as browsable indexes.

Account shell:

- Login/register/reset: minimal auth forms.
- Inbox/account status: messages, permission state, upload request CTA.

Uploader shell:

- Upload workspace: staged flow with source selection, preflight/metadata, upload progress, commit result.
- Persistent task dock: current and recent background tasks.

Admin shell:

- Dashboard: health, queues, recent audit, counts, urgent actions.
- Content management: works, releases, archive versions, creators, characters, tags, series.
- Users and audit.
- Maintenance: consistency, GC, R2/D1 health, destructive actions.

The public home page should not be the admin dashboard.

## Interaction Requirements

- Primary actions should be obvious on first scan.
- Secondary/maintenance actions should be grouped under the relevant role shell.
- Global navigation should communicate where the user is: public archive, account, upload, admin.
- Search/filter controls should stay close to catalogue results and preserve query state where practical.
- Tables are valid for admin and archive-version detail, but public discovery should not rely only on wide tables.
- Long IDs, Japanese titles, Chinese titles, and status messages must wrap without horizontal page overflow.
- Empty, loading, error, unauthorized, pending, completed, and destructive states need explicit UI.
- Destructive admin operations require visual separation and confirmation copy.

## Rebuild Slices

Prefer these slices over one giant rewrite:

1. Public shell and home information architecture.
2. Games catalogue and work detail task flow.
3. Upload workspace and task dock.
4. Account/inbox and uploader permission request.
5. Admin dashboard and navigation shell.
6. Admin detail/table ergonomics.

Each slice should include verification of its primary task path.

## Acceptance Checklist

- A user can complete the changed task without knowing internal route names.
- All previous capabilities in scope are present in the preservation map.
- Public and admin concerns are not mixed on the same default screen.
- Mobile layout has no horizontal scroll.
- Keyboard focus order follows the task sequence.
- Primary actions, error states, and permission states are visible.
- `npm run check` passes.
