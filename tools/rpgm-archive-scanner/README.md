# RPG Maker Archive Scanner

Incremental, resumable scanner for RPG Maker 2000/2003 archive planning.

The scanner is designed for the current storage plan:

- Game roots are directories containing `RPG_RT.ini`.
- Nested game roots are treated as separate games and skipped while scanning a parent.
- V1 accepts only games at or below `300 MB` and `3000` included files.
- Optional full-scan mode can hash over-limit games and mark them as `scanned_over_limit`.
- Core files are packed into one low-compression core pack per game.
- Non-core files become independent SHA-256 blobs.
- Runtime files such as `exe` and `dll` are ordinary blobs.
- Original ZIP files are not retained.

## Workflow

Run from the repository root.

```powershell
python tools\rpgm-archive-scanner\rpgm_archive_scan.py discover --root D:\
python tools\rpgm-archive-scanner\rpgm_archive_scan.py status
python tools\rpgm-archive-scanner\rpgm_archive_scan.py scan --limit 5
python tools\rpgm-archive-scanner\rpgm_archive_scan.py scan --force --include-over-limit --limit 0
python tools\rpgm-archive-scanner\rpgm_archive_scan.py report --out-md tools\rpgm-archive-scanner\reports\d-drive-rpg-maker-exact-report.md --out-json tools\rpgm-archive-scanner\reports\d-drive-rpg-maker-exact-report.json
python tools\rpgm-archive-scanner\rpgm_archive_scan.py report --include-over-limit --out-md tools\rpgm-archive-scanner\reports\d-drive-rpg-maker-exact-report-with-overlimit.md --out-json tools\rpgm-archive-scanner\reports\d-drive-rpg-maker-exact-report-with-overlimit.json
python tools\rpgm-archive-scanner\rpgm_archive_scan.py export-games
python tools\rpgm-archive-scanner\rpgm_archive_scan.py export-largest-files
python tools\rpgm-archive-scanner\rpgm_archive_scan.py export-file-types
python tools\rpgm-archive-scanner\rpgm_archive_scan.py export-files
```

Repeat `scan --limit N` until `status` shows no pending games.

Use a smaller limit first. Each accepted game is hashed precisely and committed to SQLite after it finishes, so the scan can be stopped and resumed without losing completed work.

## Commands

```text
discover
  Find RPG_RT.ini files and register game roots.

scan
  Scan pending roots. Rejected roots stop as soon as they exceed v1 limits.
  Accepted roots receive exact SHA-256 hashes for every included file.
  Use --include-over-limit to hash over-limit games completely and mark them
  as scanned_over_limit instead of rejected_limit.

status
  Show discovered/scanned/rejected/error counts.

report
  Generate Markdown and JSON cost/effect reports from scanned data.
  Use --include-over-limit to include scanned_over_limit games.

list
  List games by status.

export-files
  Export a Chinese per-file CSV plus a Chinese Markdown analysis summary.
  Default output goes under the ignored reports directory.

export-games
  Export a Chinese game-size/compression CSV plus a Markdown table sorted by
  raw game size descending.

export-largest-files
  Export the largest unique file contents and their usage status, plus a
  reference CSV showing every path that uses those contents.

export-file-types
  Export observed file type statistics against the forced whitelist.
```

## Default Files

```text
tools/rpgm-archive-scanner/workspace/rpgm_archive_scan.sqlite3
tools/rpgm-archive-scanner/reports/rpg-maker-exact-scan-report.md
tools/rpgm-archive-scanner/reports/rpg-maker-exact-scan-report.json
```

The workspace and reports directories are ignored by Git.

## Classification

Included files must match the forced file type whitelist:

```text
.avi
.bmp
.dll
.exe
.flac
.fon
.gif
.ico
.ini
.jpg
.ldb
.lmt
.lmu
.mid
.midi
.mpeg
.mp3
.mpg
.oga
.ogg
.opus
.otf
.png
.ttc
.ttf
.txt
.wav
.wma
.xyz
```

Core pack files:

```text
RPG_RT.ldb
RPG_RT.lmt
RPG_RT.ini
Map####.lmu
```

Runtime blob extensions:

```text
.exe .dll
```

Everything else is an asset blob.
