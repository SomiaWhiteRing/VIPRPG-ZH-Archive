# VIPRPG Festival UI Design Brief

Reference checked: `https://vipsummer2024.x.2nt.com/index.html` on 2026-05-05.

## Goal

Build a modern archive UI that visually echoes VIPRPG festival pages while keeping this project usable as a long-term Chinese archive, download, upload, and admin system.

This is not a pixel-perfect clone. The reference page supplies mood, colors, density, and structure. The implementation must use modern semantic HTML, responsive CSS, accessible interaction states, and maintainable components.

## Reference Visual DNA

The VIPRPG夏の陣2024 page uses:

- Fixed blue sky background and deep sea-blue page field.
- A narrow centered content column.
- Large yellow title with heavy dark drop shadow.
- Green vertical-gradient panels with bright ridge/outset borders and dark shadow.
- Warm cream/yellow headings and links over pale blue-white body text.
- MS Gothic / monospace retro text texture.
- Pixel-game banner strips and small image badges as navigation/identity anchors.
- Dense information blocks, textarea-like update logs, and table-like navigation.

Extracted reference colors:

```css
--vip-bg: #052367;
--vip-text: #f0faff;
--vip-warm: #ffebcd;
--vip-yellow: #fffd87;
--vip-border: #ebf7ff;
--vip-shadow: #1d1d1e;
--vip-pane-1: #507d5f;
--vip-pane-2: #3f6c4e;
--vip-pane-3: #2c593b;
--vip-pane-4: #1a4729;
--vip-pane-5: #073416;
--vip-selection-border: #bee8cd;
--vip-selection-outer: #2a5739;
--vip-selection-inner: #1a4729;
```

## Modern Translation

Use these visual ideas in the current app:

- Page background: deep blue base with a sky/sea suggestion. Prefer CSS gradients or lightweight generated assets; do not rely on hotlinked reference assets.
- Main shell: centered content with wider responsive max width than the old page. Public pages can feel like a festival guide board.
- Panels: reusable `.festival-pane` style with green gradient, bright border, subtle ridge feel, and controlled shadow. Radius should stay modest.
- Headings: display titles can use warm yellow, cream, or white with a dark shadow. Body copy should remain readable in Chinese.
- Navigation: modern sticky header or compact nav strip, inspired by the old table nav and banners but implemented as semantic links/buttons.
- Cards: work cards can resemble festival entries or booths, with thumbnail, metadata, status, and clear actions.
- Tables/admin: keep dense layouts, but apply theme via headers, borders, badges, and toolbars rather than oversized decorative panels.
- Upload/play flows: prioritize task progress, status, and error recovery. The festival theme should frame the workflow, not hide controls.

## Do Not Copy

- No iframe header/footer.
- No layout tables for non-tabular layout.
- No `font` tags, fake browser ad windows, autoplay clutter, or popups.
- No unreadable all-monospace body text for long Chinese content.
- No fixed `55vw` content column that breaks mobile.
- No hotlinking images from the reference site.

## Suggested CSS Patterns

```css
:root {
  --vip-bg: #052367;
  --vip-sky: #075fd4;
  --vip-text: #f0faff;
  --vip-warm: #ffebcd;
  --vip-yellow: #fffd87;
  --vip-border: #ebf7ff;
  --vip-shadow: #1d1d1e;
  --vip-pane-gradient: linear-gradient(
    #507d5f,
    #3f6c4e,
    #2c593b,
    #1a4729,
    #073416
  );
  --vip-focus: #38bdf8;
  --vip-danger: #ef4444;
  --vip-action: #f97316;
}

.festival-pane {
  border: 2px solid color-mix(in srgb, var(--vip-border) 80%, #94a3b8);
  border-radius: 8px;
  background: var(--vip-pane-gradient);
  color: var(--vip-text);
  box-shadow: 4px 4px 0 var(--vip-shadow);
}

.festival-title {
  color: var(--vip-yellow);
  text-shadow: 4px 4px 0 var(--vip-shadow);
}
```

Treat these as a starting point, not a mandatory exact API.

## Page-Level Direction

- Home: make it feel like an entrance board to a VIPRPG festival/archive. Highlight browse, upload, play, downloads, and admin state as clear zones.
- Games/list pages: searchable festival catalogue with compact filters, entry cards, thumbnails, tags, release status, and direct play/download actions.
- Work detail pages: hero pane for title/media, release timeline, archive versions, screenshots, creators, tags, and play/download.
- Creators/characters/tags/series: directory pages that feel like festival index boards.
- Login/register/reset: simple framed forms; avoid excessive decoration around authentication.
- Admin: themed operations console, not a public festival page. Keep dense tables, readable statuses, and dangerous actions visually distinct.
- Upload: modern wizard/task workspace with strong progress feedback, error recovery, and persistent upload dock.
- Web play: emulator area should dominate; theme the surrounding controls without shrinking the game canvas.

## Acceptance Checklist

For each UI task, verify:

- Desktop `1440x900` and mobile `390x844` both render without horizontal scrolling.
- Long Chinese/Japanese titles and archive IDs wrap gracefully.
- Primary actions are visible without hunting.
- Links and buttons have hover and focus states.
- Public pages have a recognizable VIPRPG festival atmosphere.
- Admin/upload/play pages remain efficient and operational.
- `npm run check` passes.
- Browser console has no relevant errors.
