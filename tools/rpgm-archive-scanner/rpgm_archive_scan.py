#!/usr/bin/env python3
"""Incremental precise scanner for RPG Maker 2000/2003 archive planning."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import locale
import os
import re
import sqlite3
import sys
import time
import zlib
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable


V1_MAX_BYTES = 300 * 1024 * 1024
V1_MAX_FILES = 3000
R2_FREE_STORAGE_BYTES = 10 * 1024**3
R2_STORAGE_USD_PER_GB_MONTH = 0.015
R2_FREE_CLASS_B_OPS = 10_000_000
MANIFEST_BYTES_PER_FILE = 220
MANIFEST_BYTES_PER_GAME = 1024

RUNTIME_EXTS = {".exe", ".dll"}
CORE_EXACT_NAMES = {"rpg_rt.ldb", "rpg_rt.lmt", "rpg_rt.ini"}
SCANNED_STATUSES = ("scanned", "scanned_over_limit")

ALLOWED_FILE_TYPE_KEYS = {
    ".ini",
    ".exe",
    ".dll",
    ".ttf",
    ".ttc",
    ".otf",
    ".fon",
    ".gif",
    ".ico",
    ".ldb",
    ".lmt",
    ".lmu",
    ".png",
    ".jpg",
    ".bmp",
    ".xyz",
    ".txt",
    ".wav",
    ".mid",
    ".midi",
    ".mp3",
    ".ogg",
    ".oga",
    ".flac",
    ".opus",
    ".wma",
    ".avi",
    ".mpg",
    ".mpeg",
}

STATIC_RESOURCE_DIRS = {
    "backdrop",
    "battle",
    "battle2",
    "battlecharset",
    "charset",
    "chipset",
    "faceset",
    "font",
    "gameover",
    "monster",
    "movie",
    "music",
    "panorama",
    "picture",
    "sound",
    "system",
    "system2",
    "title",
}

ROLE_LABELS = {
    "core": "核心文件",
    "asset": "素材资源",
    "runtime": "运行时/可执行",
}

STORAGE_LABELS = {
    "core_pack": "打入本游戏 core pack",
    "blob": "独立内容 blob",
}

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")


def repo_root() -> Path:
    return Path.cwd()


def default_workspace() -> Path:
    return repo_root() / "tools" / "rpgm-archive-scanner" / "workspace" / "rpgm_archive_scan.sqlite3"


def default_reports_dir() -> Path:
    return repo_root() / "tools" / "rpgm-archive-scanner" / "reports"


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def human_bytes(value: int | float) -> str:
    n = float(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            if unit == "B":
                return f"{n:.0f} B"
            return f"{n:.2f} {unit}"
        n /= 1024
    raise AssertionError("unreachable")


def percent(numerator: int | float, denominator: int | float) -> str:
    if not denominator:
        return "0.00%"
    return f"{(float(numerator) / float(denominator)) * 100:.2f}%"


def norm_path(path: Path | str) -> str:
    return os.path.normcase(os.path.abspath(str(path))).rstrip("\\/")


def posix_rel(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def limit_reason(file_count: int, total_bytes: int) -> str | None:
    reasons: list[str] = []
    if total_bytes > V1_MAX_BYTES:
        reasons.append("size")
    if file_count > V1_MAX_FILES:
        reasons.append("file_count")
    return ",".join(reasons) if reasons else None


def summary_statuses(include_over_limit: bool) -> tuple[str, ...]:
    return SCANNED_STATUSES if include_over_limit else ("scanned",)


def placeholders(values: tuple[object, ...] | list[object]) -> str:
    return ",".join("?" for _ in values)


def file_role(name: str) -> str:
    lower = name.lower()
    if lower in CORE_EXACT_NAMES:
        return "core"
    if (
        lower.startswith("map")
        and lower.endswith(".lmu")
        and len(lower) == len("map0001.lmu")
        and lower[3:7].isdigit()
    ):
        return "core"
    if Path(name).suffix.lower() in RUNTIME_EXTS:
        return "runtime"
    return "asset"


def file_type_key(rel_path: str) -> str:
    lower = PurePosixPath(rel_path).name.lower()
    if re.search(r"\.7z\.\d{3}$", lower):
        return ".7z.###"
    if re.search(r"\.zip\.\d{3}$", lower):
        return ".zip.###"
    if re.search(r"\.z\d{2}$", lower):
        return ".z##"
    if re.search(r"\.r\d{2}$", lower):
        return ".r##"
    if re.search(r"\.part\d+\.rar$", lower):
        return ".partN.rar"
    return PurePosixPath(lower).suffix or "(无扩展名)"


def top_level_dir(rel_path: str) -> str:
    parts = PurePosixPath(rel_path).parts
    return parts[0].lower() if len(parts) > 1 else "(root)"


def static_candidate_note(type_key: str) -> str:
    notes = {
        ".lwi": "不建议加入：通常是音频索引/缓存侧车文件，RPG Maker 2000/2003 运行不依赖它。",
        ".vix": "不建议加入：常见为目录/缩略图索引类文件，不是 RPG Maker 运行资源。",
        ".edg": "不建议加入：更像图像编辑源文件，不是引擎标准素材格式。",
        ".pdn": "不建议加入：Paint.NET 源文件，不是引擎运行资源。",
        ".pal": "不建议加入：调色板/编辑辅助文件，不是 RPG Maker 2000/2003 标准运行素材。",
    }
    return notes.get(type_key, "需要人工确认：虽然只出现在静态资源目录下，但不是当前强制白名单类型。")


def is_allowed_file_type(name: str) -> bool:
    return file_type_key(name) in ALLOWED_FILE_TYPE_KEYS


def is_excluded(name: str) -> bool:
    return not is_allowed_file_type(name)


def whitelist_status(type_key: str) -> tuple[str, str]:
    if type_key in ALLOWED_FILE_TYPE_KEYS:
        return "白名单内", "强制白名单允许的 RPG Maker 2000/2003 核心、素材、运行时或字体类型。"
    return "白名单外", "不在强制白名单内，导入时直接排除。"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def deflate_level1_size(path: Path) -> int:
    compressor = zlib.compressobj(level=1, wbits=-15)
    total = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            total += len(compressor.compress(chunk))
    total += len(compressor.flush())
    return total


def zip_entry_overhead(rel_path: str) -> int:
    name_len = len(rel_path.encode("utf-8"))
    return 30 + name_len + 46 + name_len


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    migrate(conn)
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS scan_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS games (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          root_path TEXT NOT NULL UNIQUE,
          ini_path TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'discovered',
          discovered_at TEXT NOT NULL,
          scanned_at TEXT,
          total_bytes INTEGER NOT NULL DEFAULT 0,
          file_count INTEGER NOT NULL DEFAULT 0,
          core_file_count INTEGER NOT NULL DEFAULT 0,
          core_raw_bytes INTEGER NOT NULL DEFAULT 0,
          core_pack_sha256 TEXT,
          core_pack_estimated_bytes INTEGER NOT NULL DEFAULT 0,
          non_core_file_count INTEGER NOT NULL DEFAULT 0,
          non_core_raw_bytes INTEGER NOT NULL DEFAULT 0,
          asset_file_count INTEGER NOT NULL DEFAULT 0,
          runtime_file_count INTEGER NOT NULL DEFAULT 0,
          excluded_file_count INTEGER NOT NULL DEFAULT 0,
          excluded_bytes INTEGER NOT NULL DEFAULT 0,
          failed_entry_count INTEGER NOT NULL DEFAULT 0,
          reject_reason TEXT,
          error_message TEXT
        );

        CREATE TABLE IF NOT EXISTS files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          rel_path TEXT NOT NULL,
          abs_path TEXT NOT NULL,
          role TEXT NOT NULL,
          storage_kind TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          mtime_ns INTEGER,
          core_pack_sha256 TEXT,
          UNIQUE(game_id, rel_path)
        );

        CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
        CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);
        CREATE INDEX IF NOT EXISTS idx_files_game ON files(game_id);
        CREATE INDEX IF NOT EXISTS idx_files_core_pack ON files(core_pack_sha256);
        """
    )
    existing_game_columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(games)").fetchall()
    }
    if "excluded_bytes" not in existing_game_columns:
        conn.execute("ALTER TABLE games ADD COLUMN excluded_bytes INTEGER NOT NULL DEFAULT 0")
    conn.commit()


def get_known_roots(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("SELECT root_path FROM games").fetchall()
    return {norm_path(row["root_path"]) for row in rows}


def discover_with_walk(root: Path, ini_name: str) -> list[Path]:
    # Use Python's Unicode filesystem APIs. Parsing `cmd /c dir` output is faster
    # but loses paths containing characters outside the active console code page.
    wanted = ini_name.lower()
    paths: list[Path] = []
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(Path(entry.path))
                        elif entry.is_file(follow_symlinks=False) and entry.name.lower() == wanted:
                            paths.append(Path(entry.path))
                    except OSError:
                        continue
        except OSError:
            continue
    return sorted(set(paths), key=lambda p: str(p).lower())


def command_discover(args: argparse.Namespace) -> None:
    conn = connect(args.workspace)
    root = Path(args.root)
    ini_paths = discover_with_walk(root, args.ini_name)
    inserted = 0
    updated = 0
    for ini_path in ini_paths:
        game_root = ini_path.parent
        existing = conn.execute(
            "SELECT id, ini_path FROM games WHERE root_path = ?", (str(game_root),)
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE games SET ini_path = ? WHERE id = ?",
                (str(ini_path), existing["id"]),
            )
            updated += 1
        else:
            conn.execute(
                """
                INSERT INTO games(root_path, ini_path, status, discovered_at)
                VALUES (?, ?, 'discovered', ?)
                """,
                (str(game_root), str(ini_path), now_iso()),
            )
            inserted += 1
    conn.execute(
        "INSERT OR REPLACE INTO scan_meta(key, value) VALUES ('last_discover_root', ?)",
        (str(root),),
    )
    conn.commit()
    print(f"found_ini={len(ini_paths)} inserted={inserted} updated={updated}")
    print(f"workspace={args.workspace}")


@dataclass
class FileRecord:
    rel_path: str
    abs_path: Path
    role: str
    storage_kind: str
    size_bytes: int
    sha256: str
    mtime_ns: int | None
    core_pack_sha256: str | None = None


def iter_included_files(
    root: Path,
    all_roots_norm: set[str],
    stop_at_limit: bool,
) -> tuple[list[Path], int, int, int, bool, str | None]:
    root_norm = norm_path(root)
    stack = [root]
    files: list[Path] = []
    total_bytes = 0
    excluded = 0
    excluded_bytes = 0
    stopped = False
    reject_reason: str | None = None
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                dirs: list[Path] = []
                for entry in entries:
                    try:
                        entry_path = Path(entry.path)
                        if entry.is_dir(follow_symlinks=False):
                            entry_norm = norm_path(entry_path)
                            if entry_norm != root_norm and entry_norm in all_roots_norm:
                                continue
                            dirs.append(entry_path)
                            continue
                        if not entry.is_file(follow_symlinks=False):
                            continue
                        stat = entry.stat(follow_symlinks=False)
                        if is_excluded(entry.name):
                            excluded += 1
                            excluded_bytes += int(stat.st_size)
                            continue
                        files.append(entry_path)
                        total_bytes += int(stat.st_size)
                        if stop_at_limit:
                            if len(files) > V1_MAX_FILES:
                                stopped = True
                                reject_reason = "file_count"
                                return files, total_bytes, excluded, excluded_bytes, stopped, reject_reason
                            if total_bytes > V1_MAX_BYTES:
                                stopped = True
                                reject_reason = "size"
                                return files, total_bytes, excluded, excluded_bytes, stopped, reject_reason
                    except OSError:
                        continue
                stack.extend(dirs)
        except OSError:
            continue
    return files, total_bytes, excluded, excluded_bytes, stopped, reject_reason


def scan_one_game(
    conn: sqlite3.Connection,
    game: sqlite3.Row,
    all_roots_norm: set[str],
    enforce_limits: bool,
) -> str:
    root = Path(game["root_path"])
    files, total_bytes, excluded, excluded_bytes, stopped, reject_reason = iter_included_files(
        root, all_roots_norm, stop_at_limit=enforce_limits
    )
    if stopped and enforce_limits:
        conn.execute("DELETE FROM files WHERE game_id = ?", (game["id"],))
        conn.execute(
            """
            UPDATE games
            SET status = 'rejected_limit',
                scanned_at = ?,
                total_bytes = ?,
                file_count = ?,
                excluded_file_count = ?,
                excluded_bytes = ?,
                reject_reason = ?,
                error_message = NULL
            WHERE id = ?
            """,
            (now_iso(), total_bytes, len(files), excluded, excluded_bytes, reject_reason, game["id"]),
        )
        conn.commit()
        return "rejected_limit"

    reject_reason = limit_reason(len(files), total_bytes)
    status = "scanned_over_limit" if reject_reason else "scanned"

    records: list[FileRecord] = []
    core_signature_parts: list[str] = []
    core_pack_estimated_bytes = 22
    stats = {
        "core_file_count": 0,
        "core_raw_bytes": 0,
        "non_core_file_count": 0,
        "non_core_raw_bytes": 0,
        "asset_file_count": 0,
        "runtime_file_count": 0,
        "failed_entry_count": 0,
    }
    for path in files:
        try:
            stat = path.stat()
            rel_path = posix_rel(root, path)
            role = file_role(path.name)
            digest = sha256_file(path)
            size = int(stat.st_size)
            mtime_ns = getattr(stat, "st_mtime_ns", None)
            if role == "core":
                storage_kind = "core_pack"
                stats["core_file_count"] += 1
                stats["core_raw_bytes"] += size
                compressed_size = deflate_level1_size(path)
                core_pack_estimated_bytes += compressed_size + zip_entry_overhead(rel_path)
                core_signature_parts.append(f"{rel_path}|{size}|{digest}")
            else:
                storage_kind = "blob"
                stats["non_core_file_count"] += 1
                stats["non_core_raw_bytes"] += size
                if role == "runtime":
                    stats["runtime_file_count"] += 1
                else:
                    stats["asset_file_count"] += 1
            records.append(
                FileRecord(
                    rel_path=rel_path,
                    abs_path=path,
                    role=role,
                    storage_kind=storage_kind,
                    size_bytes=size,
                    sha256=digest,
                    mtime_ns=mtime_ns,
                )
            )
        except OSError:
            stats["failed_entry_count"] += 1

    core_signature = "\n".join(sorted(core_signature_parts))
    core_pack_sha256 = hashlib.sha256(core_signature.encode("utf-8")).hexdigest() if core_signature else None
    for record in records:
        if record.storage_kind == "core_pack":
            record.core_pack_sha256 = core_pack_sha256

    with conn:
        conn.execute("DELETE FROM files WHERE game_id = ?", (game["id"],))
        conn.executemany(
            """
            INSERT INTO files(
              game_id, rel_path, abs_path, role, storage_kind,
              size_bytes, sha256, mtime_ns, core_pack_sha256
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    game["id"],
                    record.rel_path,
                    str(record.abs_path),
                    record.role,
                    record.storage_kind,
                    record.size_bytes,
                    record.sha256,
                    record.mtime_ns,
                    record.core_pack_sha256,
                )
                for record in records
            ],
        )
        conn.execute(
            """
            UPDATE games
            SET status = ?,
                scanned_at = ?,
                total_bytes = ?,
                file_count = ?,
                core_file_count = ?,
                core_raw_bytes = ?,
                core_pack_sha256 = ?,
                core_pack_estimated_bytes = ?,
                non_core_file_count = ?,
                non_core_raw_bytes = ?,
                asset_file_count = ?,
                runtime_file_count = ?,
                excluded_file_count = ?,
                excluded_bytes = ?,
                failed_entry_count = ?,
                reject_reason = ?,
                error_message = NULL
            WHERE id = ?
            """,
            (
                status,
                now_iso(),
                total_bytes,
                len(records),
                stats["core_file_count"],
                stats["core_raw_bytes"],
                core_pack_sha256,
                core_pack_estimated_bytes if core_pack_sha256 else 0,
                stats["non_core_file_count"],
                stats["non_core_raw_bytes"],
                stats["asset_file_count"],
                stats["runtime_file_count"],
                excluded,
                excluded_bytes,
                stats["failed_entry_count"],
                reject_reason,
                game["id"],
            ),
        )
    return status


def command_scan(args: argparse.Namespace) -> None:
    conn = connect(args.workspace)
    all_roots_norm = get_known_roots(conn)
    statuses = (
        ("discovered", "error")
        if not args.force
        else ("discovered", "error", "scanned", "scanned_over_limit", "rejected_limit")
    )
    query = f"SELECT * FROM games WHERE status IN ({placeholders(statuses)}) ORDER BY root_path"
    games = conn.execute(query, statuses).fetchall()
    if args.path_contains:
        needle = args.path_contains.lower()
        games = [game for game in games if needle in game["root_path"].lower()]
    limit = None if args.limit == 0 else args.limit
    if limit is not None:
        games = games[:limit]

    scanned = 0
    scanned_over_limit = 0
    rejected = 0
    errors = 0
    for index, game in enumerate(games, start=1):
        print(f"[{index}/{len(games)}] {game['root_path']}", flush=True)
        try:
            result = scan_one_game(conn, game, all_roots_norm, enforce_limits=not args.include_over_limit)
            if result == "scanned":
                scanned += 1
            elif result == "scanned_over_limit":
                scanned_over_limit += 1
            elif result == "rejected_limit":
                rejected += 1
            print(f"  -> {result}", flush=True)
        except Exception as exc:  # noqa: BLE001 - keep scanner resilient.
            errors += 1
            conn.execute(
                """
                UPDATE games
                SET status = 'error', scanned_at = ?, error_message = ?
                WHERE id = ?
                """,
                (now_iso(), str(exc), game["id"]),
            )
            conn.commit()
            print(f"  -> error: {exc}", flush=True)
    print(
        f"scanned={scanned} scanned_over_limit={scanned_over_limit} "
        f"rejected_limit={rejected} errors={errors} remaining={pending_count(conn)}"
    )


def pending_count(conn: sqlite3.Connection) -> int:
    return int(
        conn.execute(
            "SELECT COUNT(*) FROM games WHERE status IN ('discovered', 'error')"
        ).fetchone()[0]
    )


def command_status(args: argparse.Namespace) -> None:
    conn = connect(args.workspace)
    rows = conn.execute(
        "SELECT status, COUNT(*) AS count FROM games GROUP BY status ORDER BY status"
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) FROM games").fetchone()[0]
    print(f"workspace={args.workspace}")
    print(f"total_games={total}")
    for row in rows:
        print(f"{row['status']}={row['count']}")
    scanned = conn.execute("SELECT COUNT(*) FROM games WHERE status IN ('scanned', 'scanned_over_limit')").fetchone()[0]
    if scanned:
        summary = calculate_summary(conn, include_over_limit=True)
        print(f"scanned_raw={human_bytes(summary['accepted_raw_bytes'])}")
        print(f"plan_storage={human_bytes(summary['plan_storage_bytes'])}")
        print(f"class_b_with_core={summary['class_b_with_core']}")


def command_list(args: argparse.Namespace) -> None:
    conn = connect(args.workspace)
    params: list[object] = []
    where = ""
    if args.status:
        where = "WHERE status = ?"
        params.append(args.status)
    rows = conn.execute(
        f"""
        SELECT id, status, root_path, total_bytes, file_count, reject_reason, error_message
        FROM games
        {where}
        ORDER BY root_path
        LIMIT ?
        """,
        (*params, args.limit),
    ).fetchall()
    for row in rows:
        detail = row["reject_reason"] or row["error_message"] or ""
        print(
            f"{row['id']:>4} {row['status']:<14} {human_bytes(row['total_bytes']):>10} "
            f"{row['file_count']:>6} {row['root_path']} {detail}"
        )


def calculate_summary(conn: sqlite3.Connection, include_over_limit: bool = False) -> dict[str, int | float | str]:
    statuses = summary_statuses(include_over_limit)
    status_sql = placeholders(statuses)
    game_row = conn.execute(
        f"""
        SELECT
          COUNT(*) AS game_count,
          COALESCE(SUM(total_bytes), 0) AS accepted_raw_bytes,
          COALESCE(SUM(file_count), 0) AS accepted_file_count,
          COALESCE(SUM(core_file_count), 0) AS core_file_count,
          COALESCE(SUM(core_raw_bytes), 0) AS core_raw_bytes,
          COALESCE(SUM(non_core_file_count), 0) AS non_core_file_count,
          COALESCE(SUM(non_core_raw_bytes), 0) AS non_core_raw_bytes,
          COALESCE(SUM(excluded_file_count), 0) AS excluded_file_count,
          COALESCE(SUM(excluded_bytes), 0) AS excluded_bytes
        FROM games
        WHERE status IN ({status_sql})
        """,
        statuses,
    ).fetchone()
    unique_blob_row = conn.execute(
        f"""
        SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes
        FROM (
          SELECT f.sha256, MAX(f.size_bytes) AS size_bytes
          FROM files f
          JOIN games g ON g.id = f.game_id
          WHERE f.storage_kind = 'blob' AND g.status IN ({status_sql})
          GROUP BY f.sha256
        )
        """,
        statuses,
    ).fetchone()
    unique_core_row = conn.execute(
        f"""
        SELECT COUNT(*) AS count, COALESCE(SUM(core_pack_estimated_bytes), 0) AS bytes
        FROM (
          SELECT core_pack_sha256, MAX(core_pack_estimated_bytes) AS core_pack_estimated_bytes
          FROM games
          WHERE status IN ({status_sql}) AND core_pack_sha256 IS NOT NULL
          GROUP BY core_pack_sha256
        )
        """,
        statuses,
    ).fetchone()
    rejected_count = int(
        conn.execute("SELECT COUNT(*) FROM games WHERE status = 'rejected_limit'").fetchone()[0]
    )
    scanned_over_limit_count = int(
        conn.execute("SELECT COUNT(*) FROM games WHERE status = 'scanned_over_limit'").fetchone()[0]
    )
    discovered_count = int(
        conn.execute("SELECT COUNT(*) FROM games WHERE status = 'discovered'").fetchone()[0]
    )
    error_count = int(conn.execute("SELECT COUNT(*) FROM games WHERE status = 'error'").fetchone()[0])
    manifest_bytes = int(game_row["accepted_file_count"]) * MANIFEST_BYTES_PER_FILE + int(
        game_row["game_count"]
    ) * MANIFEST_BYTES_PER_GAME
    plan_storage = int(unique_blob_row["bytes"]) + int(unique_core_row["bytes"]) + manifest_bytes
    accepted_raw = int(game_row["accepted_raw_bytes"])
    saving_bytes = accepted_raw - plan_storage
    storage_over_free = max(0, plan_storage - R2_FREE_STORAGE_BYTES)
    class_b_no_core = int(game_row["accepted_file_count"])
    class_b_with_core = int(game_row["game_count"]) + int(game_row["non_core_file_count"])
    class_b_cached_zip = int(game_row["game_count"])
    return {
        "scanned_game_count": int(game_row["game_count"]),
        "included_over_limit_count": scanned_over_limit_count if include_over_limit else 0,
        "available_over_limit_count": scanned_over_limit_count,
        "rejected_limit_count": rejected_count,
        "discovered_count": discovered_count,
        "error_count": error_count,
        "accepted_raw_bytes": accepted_raw,
        "accepted_file_count": int(game_row["accepted_file_count"]),
        "core_file_count": int(game_row["core_file_count"]),
        "core_raw_bytes": int(game_row["core_raw_bytes"]),
        "non_core_file_count": int(game_row["non_core_file_count"]),
        "non_core_raw_bytes": int(game_row["non_core_raw_bytes"]),
        "excluded_file_count": int(game_row["excluded_file_count"]),
        "excluded_bytes": int(game_row["excluded_bytes"]),
        "unique_blob_count": int(unique_blob_row["count"]),
        "unique_blob_bytes": int(unique_blob_row["bytes"]),
        "unique_core_pack_count": int(unique_core_row["count"]),
        "unique_core_pack_bytes": int(unique_core_row["bytes"]),
        "manifest_bytes": manifest_bytes,
        "plan_storage_bytes": plan_storage,
        "saving_bytes": saving_bytes,
        "saving_percent": round((saving_bytes / accepted_raw) * 100, 2) if accepted_raw else 0,
        "storage_over_free_bytes": storage_over_free,
        "monthly_storage_usd": round((storage_over_free / 1024**3) * R2_STORAGE_USD_PER_GB_MONTH, 4),
        "initial_class_a_ops": int(unique_blob_row["count"]) + int(unique_core_row["count"]) + int(game_row["game_count"]),
        "class_b_no_core": class_b_no_core,
        "class_b_with_core": class_b_with_core,
        "class_b_cached_zip": class_b_cached_zip,
        "class_b_saved_by_core": class_b_no_core - class_b_with_core,
        "catalog_rounds_before_class_b_free": int(R2_FREE_CLASS_B_OPS // class_b_with_core)
        if class_b_with_core
        else 0,
    }


def command_report(args: argparse.Namespace) -> None:
    conn = connect(args.workspace)
    statuses = summary_statuses(args.include_over_limit)
    status_sql = placeholders(statuses)
    summary = calculate_summary(conn, include_over_limit=args.include_over_limit)
    largest_rows = conn.execute(
        f"""
        SELECT id, root_path, total_bytes, file_count, core_file_count,
               non_core_file_count, runtime_file_count
        FROM games
        WHERE status IN ({status_sql})
        ORDER BY total_bytes DESC
        LIMIT 30
        """,
        statuses,
    ).fetchall()
    over_limit_rows = conn.execute(
        """
        SELECT id, root_path, total_bytes, file_count, core_file_count,
               non_core_file_count, runtime_file_count, reject_reason
        FROM games
        WHERE status = 'scanned_over_limit'
        ORDER BY total_bytes DESC
        LIMIT 50
        """
    ).fetchall()
    rejected_rows = conn.execute(
        """
        SELECT id, root_path, total_bytes, file_count, reject_reason
        FROM games
        WHERE status = 'rejected_limit'
        ORDER BY total_bytes DESC
        LIMIT 50
        """
    ).fetchall()
    report = {
        "generated_at": now_iso(),
        "workspace": str(args.workspace),
        "summary": summary,
        "assumptions": {
            "hash_scope": "Games with status=scanned and status=scanned_over_limit are included."
            if args.include_over_limit
            else "Only games with status=scanned are included; status=scanned_over_limit is excluded.",
            "v1_limit": "300 MB and 3000 included files per game.",
            "forced_file_type_whitelist": sorted(ALLOWED_FILE_TYPE_KEYS),
            "core_files": ["RPG_RT.ldb", "RPG_RT.lmt", "RPG_RT.ini", "Map####.lmu"],
            "runtime_files": sorted(RUNTIME_EXTS),
            "manifest_estimate": f"{MANIFEST_BYTES_PER_FILE} bytes per file plus {MANIFEST_BYTES_PER_GAME} bytes per game.",
        },
        "largest_scanned_games": [dict(row) for row in largest_rows],
        "largest_scanned_over_limit_games": [dict(row) for row in over_limit_rows],
        "largest_rejected_games": [dict(row) for row in rejected_rows],
    }
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.write_text(render_markdown(report), encoding="utf-8")
    print(f"json={args.out_json}")
    print(f"md={args.out_md}")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def render_markdown(report: dict[str, object]) -> str:
    summary = report["summary"]
    assert isinstance(summary, dict)
    lines = [
        "# RPG Maker 2000/2003 Exact Scan Report",
        "",
        f"Generated: {report['generated_at']}",
        "",
        "## Summary",
        "",
        f"- Scanned games: {summary['scanned_game_count']}",
        f"- Included over-limit games: {summary['included_over_limit_count']} (available: {summary['available_over_limit_count']})",
        f"- Rejected by v1 limit: {summary['rejected_limit_count']}",
        f"- Pending discovery/error: {summary['discovered_count']} / {summary['error_count']}",
        f"- Accepted raw bytes: {human_bytes(summary['accepted_raw_bytes'])} / {summary['accepted_file_count']} files",
        f"- Excluded by rules: {human_bytes(summary['excluded_bytes'])} / {summary['excluded_file_count']} files",
        f"- Core raw bytes: {human_bytes(summary['core_raw_bytes'])} / {summary['core_file_count']} files",
        f"- Non-core raw bytes: {human_bytes(summary['non_core_raw_bytes'])} / {summary['non_core_file_count']} files",
        f"- Unique blob storage: {human_bytes(summary['unique_blob_bytes'])} / {summary['unique_blob_count']} blobs",
        f"- Unique core pack storage estimate: {human_bytes(summary['unique_core_pack_bytes'])} / {summary['unique_core_pack_count']} packs",
        f"- Manifest estimate: {human_bytes(summary['manifest_bytes'])}",
        f"- Plan storage estimate: {human_bytes(summary['plan_storage_bytes'])}",
        f"- Saving vs accepted raw: {human_bytes(summary['saving_bytes'])} / {summary['saving_percent']}%",
        f"- R2 10 GB overage: {human_bytes(summary['storage_over_free_bytes'])}",
        f"- Estimated monthly R2 storage cost: USD {summary['monthly_storage_usd']}",
        f"- Initial Class A object writes: {summary['initial_class_a_ops']}",
        "",
        "## Class B",
        "",
        f"- Without core pack: {summary['class_b_no_core']} R2 Get ops per accepted-catalog round",
        f"- With core pack: {summary['class_b_with_core']} R2 Get ops per accepted-catalog round",
        f"- With final ZIP cache: {summary['class_b_cached_zip']} R2 Get ops per accepted-catalog round",
        f"- Core pack savings: {summary['class_b_saved_by_core']} R2 Get ops per accepted-catalog round",
        f"- 10M Class B free tier supports about {summary['catalog_rounds_before_class_b_free']} accepted-catalog rounds with core pack and no final ZIP cache",
        "",
        "## Largest Scanned Games",
        "",
        "| ID | Path | Size | Files | Core | Non-core | Runtime |",
        "|---:|---|---:|---:|---:|---:|---:|",
    ]
    for row in report["largest_scanned_games"]:
        lines.append(
            f"| {row['id']} | `{str(row['root_path']).replace('|', '/')}` | "
            f"{human_bytes(row['total_bytes'])} | {row['file_count']} | "
            f"{row['core_file_count']} | {row['non_core_file_count']} | {row['runtime_file_count']} |"
        )
    lines.extend(
        [
            "",
            "## Largest Scanned Over-Limit Games",
            "",
            "| ID | Path | Size | Files | Core | Non-core | Runtime | Reason |",
            "|---:|---|---:|---:|---:|---:|---:|---|",
        ]
    )
    for row in report["largest_scanned_over_limit_games"]:
        lines.append(
            f"| {row['id']} | `{str(row['root_path']).replace('|', '/')}` | "
            f"{human_bytes(row['total_bytes'])} | {row['file_count']} | "
            f"{row['core_file_count']} | {row['non_core_file_count']} | "
            f"{row['runtime_file_count']} | {row['reject_reason']} |"
        )
    lines.extend(
        [
            "",
            "## Largest Rejected Games",
            "",
            "| ID | Path | Scanned Size Before Stop | Scanned Files | Reason |",
            "|---:|---|---:|---:|---|",
        ]
    )
    for row in report["largest_rejected_games"]:
        lines.append(
            f"| {row['id']} | `{str(row['root_path']).replace('|', '/')}` | "
            f"{human_bytes(row['total_bytes'])} | {row['file_count']} | {row['reject_reason']} |"
        )
    lines.extend(["", "## Assumptions", ""])
    assumptions = report["assumptions"]
    assert isinstance(assumptions, dict)
    for value in assumptions.values():
        if isinstance(value, list):
            lines.append(f"- {', '.join(value)}")
        else:
            lines.append(f"- {value}")
    return "\n".join(lines) + "\n"


def write_file_detail_csv(conn: sqlite3.Connection, out_csv: Path) -> int:
    rows = conn.execute(
        """
        WITH blob_stats AS (
          SELECT sha256, COUNT(*) AS blob_ref_count, MIN(id) AS first_file_id
          FROM files
          WHERE storage_kind = 'blob'
          GROUP BY sha256
        ),
        first_blob AS (
          SELECT f.id, g.root_path AS first_game_path, f.rel_path AS first_rel_path
          FROM files f
          JOIN games g ON g.id = f.game_id
        )
        SELECT
          f.id,
          f.game_id,
          g.root_path,
          f.rel_path,
          f.role,
          f.storage_kind,
          f.size_bytes,
          f.sha256,
          f.mtime_ns,
          f.core_pack_sha256,
          bs.blob_ref_count,
          bs.first_file_id,
          fb.first_game_path,
          fb.first_rel_path
        FROM files f
        JOIN games g ON g.id = f.game_id
        LEFT JOIN blob_stats bs ON bs.sha256 = f.sha256 AND f.storage_kind = 'blob'
        LEFT JOIN first_blob fb ON fb.id = bs.first_file_id
        ORDER BY g.root_path COLLATE NOCASE, f.rel_path COLLATE NOCASE
        """
    )
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    headers = [
        "文件记录ID",
        "游戏ID",
        "游戏路径",
        "文件相对路径",
        "文件名",
        "角色",
        "存储方式",
        "大小(Bytes)",
        "大小(易读)",
        "SHA-256",
        "归档对象类型",
        "归档对象SHA-256",
        "Blob引用次数",
        "Blob重复性",
        "是否计入唯一Blob存储",
        "唯一Blob计入大小(Bytes)",
        "首个相同Blob所在游戏",
        "首个相同Blob相对路径",
        "下载读取说明",
        "文件修改时间(ns)",
    ]
    count = 0
    with out_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        for row in rows:
            storage_kind = row["storage_kind"]
            is_blob = storage_kind == "blob"
            blob_ref_count = int(row["blob_ref_count"] or 0)
            first_file_id = row["first_file_id"]
            is_first_blob_ref = is_blob and first_file_id == row["id"]
            if is_blob and blob_ref_count > 1:
                blob_uniqueness = "重复 blob"
            elif is_blob:
                blob_uniqueness = "唯一 blob"
            else:
                blob_uniqueness = "随 core pack 处理"
            object_type = "core_pack" if storage_kind == "core_pack" else "blob"
            object_sha = row["core_pack_sha256"] if storage_kind == "core_pack" else row["sha256"]
            if storage_kind == "core_pack":
                read_note = "同一游戏的核心文件共用一次 core pack 读取"
                unique_blob_storage = "不适用"
                unique_blob_bytes = ""
                ref_count_value = ""
                first_game = ""
                first_rel = ""
            else:
                read_note = "作为独立 blob 读取"
                unique_blob_storage = "是" if is_first_blob_ref else "否"
                unique_blob_bytes = row["size_bytes"] if is_first_blob_ref else 0
                ref_count_value = blob_ref_count
                first_game = row["first_game_path"] if blob_ref_count > 1 else ""
                first_rel = row["first_rel_path"] if blob_ref_count > 1 else ""
            writer.writerow(
                [
                    row["id"],
                    row["game_id"],
                    row["root_path"],
                    row["rel_path"],
                    PurePosixPath(row["rel_path"]).name,
                    ROLE_LABELS.get(row["role"], row["role"]),
                    STORAGE_LABELS.get(storage_kind, storage_kind),
                    row["size_bytes"],
                    human_bytes(row["size_bytes"]),
                    row["sha256"],
                    object_type,
                    object_sha,
                    ref_count_value,
                    blob_uniqueness,
                    unique_blob_storage,
                    unique_blob_bytes,
                    first_game,
                    first_rel,
                    read_note,
                    row["mtime_ns"] if row["mtime_ns"] is not None else "",
                ]
            )
            count += 1
    return count


def fetch_file_analysis(conn: sqlite3.Connection, duplicate_limit: int) -> dict[str, object]:
    summary = calculate_summary(conn)
    role_rows = conn.execute(
        """
        SELECT role, storage_kind, COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes
        FROM files
        GROUP BY role, storage_kind
        ORDER BY storage_kind, role
        """
    ).fetchall()
    storage_rows = conn.execute(
        """
        SELECT storage_kind, COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes
        FROM files
        GROUP BY storage_kind
        ORDER BY storage_kind
        """
    ).fetchall()
    blob_summary = conn.execute(
        """
        WITH blob_groups AS (
          SELECT sha256, COUNT(*) AS refs, MAX(size_bytes) AS size_bytes
          FROM files
          WHERE storage_kind = 'blob'
          GROUP BY sha256
        )
        SELECT
          COUNT(*) AS unique_blob_count,
          COALESCE(SUM(refs), 0) AS blob_file_refs,
          COALESCE(SUM(size_bytes), 0) AS unique_blob_bytes,
          COALESCE(SUM(refs * size_bytes), 0) AS raw_blob_bytes,
          COALESCE(SUM((refs - 1) * size_bytes), 0) AS saved_blob_bytes,
          COALESCE(SUM(CASE WHEN refs > 1 THEN 1 ELSE 0 END), 0) AS duplicate_blob_groups,
          COALESCE(SUM(CASE WHEN refs > 1 THEN refs ELSE 0 END), 0) AS duplicate_blob_refs
        FROM blob_groups
        """
    ).fetchone()
    core_pack_summary = conn.execute(
        """
        WITH core_groups AS (
          SELECT core_pack_sha256, COUNT(*) AS games, MAX(core_pack_estimated_bytes) AS size_bytes
          FROM games
          WHERE status = 'scanned' AND core_pack_sha256 IS NOT NULL
          GROUP BY core_pack_sha256
        )
        SELECT
          COUNT(*) AS unique_core_pack_count,
          COALESCE(SUM(games), 0) AS core_pack_refs,
          COALESCE(SUM(size_bytes), 0) AS unique_core_pack_bytes,
          COALESCE(SUM(games * size_bytes), 0) AS raw_core_pack_bytes,
          COALESCE(SUM((games - 1) * size_bytes), 0) AS saved_core_pack_bytes,
          COALESCE(SUM(CASE WHEN games > 1 THEN 1 ELSE 0 END), 0) AS duplicate_core_pack_groups,
          COALESCE(SUM(CASE WHEN games > 1 THEN games ELSE 0 END), 0) AS duplicate_core_pack_refs
        FROM core_groups
        """
    ).fetchone()
    duplicate_blob_rows = conn.execute(
        """
        WITH blob_groups AS (
          SELECT sha256, COUNT(*) AS refs, MAX(size_bytes) AS size_bytes, MIN(id) AS first_file_id
          FROM files
          WHERE storage_kind = 'blob'
          GROUP BY sha256
          HAVING COUNT(*) > 1
        )
        SELECT
          bg.sha256,
          bg.refs,
          bg.size_bytes,
          ((bg.refs - 1) * bg.size_bytes) AS saved_bytes,
          g.root_path,
          f.rel_path
        FROM blob_groups bg
        JOIN files f ON f.id = bg.first_file_id
        JOIN games g ON g.id = f.game_id
        ORDER BY saved_bytes DESC, bg.refs DESC, bg.sha256
        LIMIT ?
        """,
        (duplicate_limit,),
    ).fetchall()
    duplicate_core_pack_rows = conn.execute(
        """
        WITH core_groups AS (
          SELECT core_pack_sha256, COUNT(*) AS games, MAX(core_pack_estimated_bytes) AS size_bytes
          FROM games
          WHERE status = 'scanned' AND core_pack_sha256 IS NOT NULL
          GROUP BY core_pack_sha256
          HAVING COUNT(*) > 1
        )
        SELECT
          cg.core_pack_sha256,
          cg.games,
          cg.size_bytes,
          ((cg.games - 1) * cg.size_bytes) AS saved_bytes,
          MIN(g.root_path) AS example_game
        FROM core_groups cg
        JOIN games g ON g.core_pack_sha256 = cg.core_pack_sha256
        GROUP BY cg.core_pack_sha256, cg.games, cg.size_bytes
        ORDER BY saved_bytes DESC, cg.games DESC, cg.core_pack_sha256
        LIMIT ?
        """,
        (duplicate_limit,),
    ).fetchall()
    return {
        "summary": summary,
        "role_rows": [dict(row) for row in role_rows],
        "storage_rows": [dict(row) for row in storage_rows],
        "blob_summary": dict(blob_summary),
        "core_pack_summary": dict(core_pack_summary),
        "duplicate_blob_rows": [dict(row) for row in duplicate_blob_rows],
        "duplicate_core_pack_rows": [dict(row) for row in duplicate_core_pack_rows],
    }


def render_file_analysis_markdown(analysis: dict[str, object], out_csv: Path) -> str:
    summary = analysis["summary"]
    assert isinstance(summary, dict)
    blob_summary = analysis["blob_summary"]
    assert isinstance(blob_summary, dict)
    core_pack_summary = analysis["core_pack_summary"]
    assert isinstance(core_pack_summary, dict)
    lines = [
        "# RPG Maker 2000/2003 逐文件分析结果",
        "",
        f"Generated: {now_iso()}",
        "",
        "## 范围",
        "",
        f"- 逐文件 CSV: `{out_csv}`",
        f"- 覆盖已接受游戏: {summary['scanned_game_count']} 个",
        f"- 覆盖文件: {summary['accepted_file_count']} 个",
        f"- 不含超限拒绝游戏: {summary['rejected_limit_count']} 个；这些目录只保留游戏级拒绝信息，未保留完整逐文件明细。",
        "",
        "## 存储效果",
        "",
        f"- 原始接受数据: {human_bytes(summary['accepted_raw_bytes'])}",
        f"- 计划存储估计: {human_bytes(summary['plan_storage_bytes'])}",
        f"- 节省: {human_bytes(summary['saving_bytes'])} / {summary['saving_percent']}%",
        f"- 唯一 blob: {summary['unique_blob_count']} 个 / {human_bytes(summary['unique_blob_bytes'])}",
        f"- 唯一 core pack: {summary['unique_core_pack_count']} 个 / {human_bytes(summary['unique_core_pack_bytes'])}",
        f"- manifest 估计: {human_bytes(summary['manifest_bytes'])}",
        "",
        "## 文件角色",
        "",
        "| 角色 | 存储方式 | 文件数 | 原始大小 |",
        "|---|---|---:|---:|",
    ]
    for row in analysis["role_rows"]:
        lines.append(
            f"| {ROLE_LABELS.get(row['role'], row['role'])} | "
            f"{STORAGE_LABELS.get(row['storage_kind'], row['storage_kind'])} | "
            f"{row['count']} | {human_bytes(row['bytes'])} |"
        )
    lines.extend(
        [
            "",
            "## 存储方式",
            "",
            "| 存储方式 | 文件引用数 | 原始大小 |",
            "|---|---:|---:|",
        ]
    )
    for row in analysis["storage_rows"]:
        lines.append(
            f"| {STORAGE_LABELS.get(row['storage_kind'], row['storage_kind'])} | "
            f"{row['count']} | {human_bytes(row['bytes'])} |"
        )
    raw_blob_bytes = int(blob_summary["raw_blob_bytes"])
    saved_blob_bytes = int(blob_summary["saved_blob_bytes"])
    raw_core_pack_bytes = int(core_pack_summary["raw_core_pack_bytes"])
    saved_core_pack_bytes = int(core_pack_summary["saved_core_pack_bytes"])
    lines.extend(
        [
            "",
            "## Blob 重复情况",
            "",
            f"- blob 文件引用: {blob_summary['blob_file_refs']} 个",
            f"- 唯一 blob: {blob_summary['unique_blob_count']} 个",
            f"- 重复 blob 组: {blob_summary['duplicate_blob_groups']} 组，涉及 {blob_summary['duplicate_blob_refs']} 个文件引用",
            f"- blob 去重节省估计: {human_bytes(saved_blob_bytes)} / {percent(saved_blob_bytes, raw_blob_bytes)}",
            "",
            "## Core Pack 重复情况",
            "",
            f"- core pack 引用: {core_pack_summary['core_pack_refs']} 个游戏",
            f"- 唯一 core pack: {core_pack_summary['unique_core_pack_count']} 个",
            f"- 重复 core pack 组: {core_pack_summary['duplicate_core_pack_groups']} 组，涉及 {core_pack_summary['duplicate_core_pack_refs']} 个游戏",
            f"- core pack 级重复节省估计: {human_bytes(saved_core_pack_bytes)} / {percent(saved_core_pack_bytes, raw_core_pack_bytes)}",
            "",
            "## 节省最多的重复 Blob",
            "",
            "| 排名 | 引用次数 | 单文件大小 | 节省估计 | SHA-256 前 16 位 | 首次出现 |",
            "|---:|---:|---:|---:|---|---|",
        ]
    )
    for index, row in enumerate(analysis["duplicate_blob_rows"], start=1):
        example = f"{row['root_path']}/{row['rel_path']}".replace("|", "/")
        lines.append(
            f"| {index} | {row['refs']} | {human_bytes(row['size_bytes'])} | "
            f"{human_bytes(row['saved_bytes'])} | `{row['sha256'][:16]}` | `{example}` |"
        )
    lines.extend(
        [
            "",
            "## 重复 Core Pack",
            "",
            "| 排名 | 游戏数 | Core Pack 大小估计 | 节省估计 | SHA-256 前 16 位 | 示例游戏 |",
            "|---:|---:|---:|---:|---|---|",
        ]
    )
    for index, row in enumerate(analysis["duplicate_core_pack_rows"], start=1):
        example = str(row["example_game"]).replace("|", "/")
        lines.append(
            f"| {index} | {row['games']} | {human_bytes(row['size_bytes'])} | "
            f"{human_bytes(row['saved_bytes'])} | `{row['core_pack_sha256'][:16]}` | `{example}` |"
        )
    lines.extend(
        [
            "",
            "## CSV 字段说明",
            "",
            "- `角色`: 核心文件会进入每游戏一个 core pack；素材资源和运行时文件作为独立 blob。",
            "- `Blob引用次数`: 同一个 SHA-256 blob 在已接受游戏中被多少个文件路径引用。",
            "- `是否计入唯一Blob存储`: 只有同 SHA-256 的第一条 blob 记录计入唯一 blob 存储，其余记录只是引用。",
            "- `归档对象SHA-256`: core 文件显示所属 core pack 的 SHA-256；blob 文件显示文件内容 SHA-256。",
        ]
    )
    return "\n".join(lines) + "\n"


def command_export_files(args: argparse.Namespace) -> None:
    conn = connect(args.workspace)
    exported_rows = write_file_detail_csv(conn, args.out_csv)
    analysis = fetch_file_analysis(conn, args.duplicate_limit)
    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.write_text(render_file_analysis_markdown(analysis, args.out_csv), encoding="utf-8")
    print(f"csv={args.out_csv}")
    print(f"md={args.out_md}")
    print(f"rows={exported_rows}")


def collect_game_compression_rows(
    conn: sqlite3.Connection,
    include_over_limit: bool = False,
) -> list[dict[str, object]]:
    statuses = summary_statuses(include_over_limit)
    status_sql = placeholders(statuses)
    games = conn.execute(
        f"""
        SELECT
          id,
          status,
          root_path,
          total_bytes,
          file_count,
          core_file_count,
          core_raw_bytes,
          core_pack_sha256,
          core_pack_estimated_bytes,
          non_core_file_count,
          non_core_raw_bytes,
          asset_file_count,
          runtime_file_count
        FROM games
        WHERE status IN ({status_sql})
        ORDER BY total_bytes DESC, root_path COLLATE NOCASE
        """,
        statuses,
    ).fetchall()

    seen_blob_sha256: set[str] = set()
    seen_core_pack_sha256: set[str] = set()
    rows: list[dict[str, object]] = []
    cumulative_raw = 0
    cumulative_incremental = 0

    for rank, game in enumerate(games, start=1):
        blob_rows = conn.execute(
            """
            SELECT sha256, MAX(size_bytes) AS size_bytes, COUNT(*) AS refs
            FROM files
            WHERE game_id = ? AND storage_kind = 'blob'
            GROUP BY sha256
            ORDER BY sha256
            """,
            (game["id"],),
        ).fetchall()
        local_unique_blob_count = len(blob_rows)
        new_blob_count = 0
        reused_blob_count = 0
        new_blob_bytes = 0
        local_duplicate_file_refs = 0
        for blob in blob_rows:
            refs = int(blob["refs"])
            if refs > 1:
                local_duplicate_file_refs += refs - 1
            sha256 = str(blob["sha256"])
            if sha256 in seen_blob_sha256:
                reused_blob_count += 1
            else:
                seen_blob_sha256.add(sha256)
                new_blob_count += 1
                new_blob_bytes += int(blob["size_bytes"])

        core_pack_sha256 = game["core_pack_sha256"]
        core_pack_estimated_bytes = int(game["core_pack_estimated_bytes"] or 0)
        if core_pack_sha256 and core_pack_sha256 not in seen_core_pack_sha256:
            seen_core_pack_sha256.add(str(core_pack_sha256))
            new_core_pack_bytes = core_pack_estimated_bytes
            core_pack_is_new = True
        else:
            new_core_pack_bytes = 0
            core_pack_is_new = False

        manifest_bytes = int(game["file_count"]) * MANIFEST_BYTES_PER_FILE + MANIFEST_BYTES_PER_GAME
        standalone_plan_bytes = int(game["non_core_raw_bytes"]) + core_pack_estimated_bytes + manifest_bytes
        incremental_plan_bytes = new_blob_bytes + new_core_pack_bytes + manifest_bytes
        raw_bytes = int(game["total_bytes"])
        cumulative_raw += raw_bytes
        cumulative_incremental += incremental_plan_bytes

        rows.append(
            {
                "rank": rank,
                "game_id": int(game["id"]),
                "status": game["status"],
                "root_path": game["root_path"],
                "raw_bytes": raw_bytes,
                "file_count": int(game["file_count"]),
                "core_file_count": int(game["core_file_count"]),
                "core_raw_bytes": int(game["core_raw_bytes"]),
                "core_pack_estimated_bytes": core_pack_estimated_bytes,
                "non_core_file_count": int(game["non_core_file_count"]),
                "non_core_raw_bytes": int(game["non_core_raw_bytes"]),
                "asset_file_count": int(game["asset_file_count"]),
                "runtime_file_count": int(game["runtime_file_count"]),
                "local_unique_blob_count": local_unique_blob_count,
                "local_duplicate_file_refs": local_duplicate_file_refs,
                "new_blob_count": new_blob_count,
                "reused_blob_count": reused_blob_count,
                "new_blob_bytes": new_blob_bytes,
                "core_pack_is_new": core_pack_is_new,
                "new_core_pack_bytes": new_core_pack_bytes,
                "manifest_bytes": manifest_bytes,
                "standalone_plan_bytes": standalone_plan_bytes,
                "standalone_ratio": (standalone_plan_bytes / raw_bytes) if raw_bytes else 0,
                "standalone_saved_percent": (1 - (standalone_plan_bytes / raw_bytes)) * 100
                if raw_bytes
                else 0,
                "incremental_plan_bytes": incremental_plan_bytes,
                "incremental_ratio": (incremental_plan_bytes / raw_bytes) if raw_bytes else 0,
                "incremental_saved_percent": (1 - (incremental_plan_bytes / raw_bytes)) * 100
                if raw_bytes
                else 0,
                "cumulative_raw_bytes": cumulative_raw,
                "cumulative_incremental_bytes": cumulative_incremental,
                "cumulative_ratio": (cumulative_incremental / cumulative_raw) if cumulative_raw else 0,
            }
        )
    return rows


def write_game_compression_csv(rows: list[dict[str, object]], out_csv: Path) -> None:
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    headers = [
        "排名",
        "游戏ID",
        "扫描状态",
        "游戏路径",
        "原始大小(Bytes)",
        "原始大小(易读)",
        "文件数",
        "核心文件数",
        "核心原始大小(Bytes)",
        "Core Pack估计大小(Bytes)",
        "非核心文件数",
        "非核心原始大小(Bytes)",
        "素材文件数",
        "运行时文件数",
        "本游戏唯一Blob数",
        "本游戏内部重复文件引用数",
        "按大小顺序新增Blob数",
        "按大小顺序复用Blob数",
        "按大小顺序新增Blob大小(Bytes)",
        "Core Pack是否新增",
        "按大小顺序新增Core Pack大小(Bytes)",
        "Manifest估计(Bytes)",
        "单游戏计划体积(Bytes)",
        "单游戏压缩比(计划/原始)",
        "单游戏节省率",
        "按大小顺序新增存储(Bytes)",
        "按大小顺序新增存储压缩比(新增/原始)",
        "按大小顺序新增存储节省率",
        "累计原始大小(Bytes)",
        "累计新增存储(Bytes)",
        "累计压缩比(新增/原始)",
    ]
    with out_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        for row in rows:
            writer.writerow(
                [
                    row["rank"],
                    row["game_id"],
                    row["status"],
                    row["root_path"],
                    row["raw_bytes"],
                    human_bytes(row["raw_bytes"]),
                    row["file_count"],
                    row["core_file_count"],
                    row["core_raw_bytes"],
                    row["core_pack_estimated_bytes"],
                    row["non_core_file_count"],
                    row["non_core_raw_bytes"],
                    row["asset_file_count"],
                    row["runtime_file_count"],
                    row["local_unique_blob_count"],
                    row["local_duplicate_file_refs"],
                    row["new_blob_count"],
                    row["reused_blob_count"],
                    row["new_blob_bytes"],
                    "是" if row["core_pack_is_new"] else "否",
                    row["new_core_pack_bytes"],
                    row["manifest_bytes"],
                    row["standalone_plan_bytes"],
                    f"{row['standalone_ratio']:.4f}",
                    f"{row['standalone_saved_percent']:.2f}%",
                    row["incremental_plan_bytes"],
                    f"{row['incremental_ratio']:.4f}",
                    f"{row['incremental_saved_percent']:.2f}%",
                    row["cumulative_raw_bytes"],
                    row["cumulative_incremental_bytes"],
                    f"{row['cumulative_ratio']:.4f}",
                ]
            )


def render_game_compression_markdown(rows: list[dict[str, object]], out_csv: Path, limit: int) -> str:
    shown_rows = rows if limit == 0 else rows[:limit]
    total_raw = sum(int(row["raw_bytes"]) for row in rows)
    total_standalone = sum(int(row["standalone_plan_bytes"]) for row in rows)
    total_incremental = sum(int(row["incremental_plan_bytes"]) for row in rows)
    over_limit_count = sum(1 for row in rows if row["status"] == "scanned_over_limit")
    lines = [
        "# RPG Maker 2000/2003 逐游戏大小与压缩比",
        "",
        f"Generated: {now_iso()}",
        "",
        "## 口径",
        "",
        f"- 完整 CSV: `{out_csv}`",
        "- 排序方式: 按游戏原始大小从大到小。",
        f"- 本报告包含超限完整核算游戏: {over_limit_count} 个。",
        "- `单游戏压缩比`: `单游戏计划体积 / 原始大小`，只计算 core pack 低压缩和 manifest，不计算跨游戏 blob 复用。",
        "- `新增存储压缩比`: `按当前排序归档时新增存储 / 原始大小`，计算跨游戏 blob/core pack 复用；该值与处理顺序有关。",
        "- 比值越低越省空间；`1.0000` 约等于不省空间，`0.2500` 约等于只需要原始大小的四分之一。",
        "",
        "## 总览",
        "",
        f"- 游戏数: {len(rows)}",
        f"- 原始总大小: {human_bytes(total_raw)}",
        f"- 单游戏计划体积合计: {human_bytes(total_standalone)}，压缩比 {total_standalone / total_raw:.4f}，节省 {percent(total_raw - total_standalone, total_raw)}",
        f"- 按大小顺序新增存储合计: {human_bytes(total_incremental)}，压缩比 {total_incremental / total_raw:.4f}，节省 {percent(total_raw - total_incremental, total_raw)}",
        "",
        "## 游戏列表",
        "",
        "| 排名 | 状态 | 游戏路径 | 原始大小 | 文件数 | 单游戏计划体积 | 单游戏压缩比 | 单游戏节省率 | 新增存储 | 新增存储压缩比 | 新增存储节省率 | 新增/复用 Blob |",
        "|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in shown_rows:
        path = str(row["root_path"]).replace("|", "/")
        lines.append(
            f"| {row['rank']} | {row['status']} | `{path}` | {human_bytes(row['raw_bytes'])} | {row['file_count']} | "
            f"{human_bytes(row['standalone_plan_bytes'])} | {row['standalone_ratio']:.4f} | "
            f"{row['standalone_saved_percent']:.2f}% | {human_bytes(row['incremental_plan_bytes'])} | "
            f"{row['incremental_ratio']:.4f} | {row['incremental_saved_percent']:.2f}% | "
            f"{row['new_blob_count']}/{row['reused_blob_count']} |"
        )
    if limit and len(rows) > limit:
        lines.extend(["", f"Markdown 只展示前 {limit} 个游戏；完整 {len(rows)} 行见 CSV。"])
    return "\n".join(lines) + "\n"


def command_export_games(args: argparse.Namespace) -> None:
    conn = connect(args.workspace)
    rows = collect_game_compression_rows(conn, include_over_limit=args.include_over_limit)
    write_game_compression_csv(rows, args.out_csv)
    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.write_text(
        render_game_compression_markdown(rows, args.out_csv, args.markdown_limit),
        encoding="utf-8",
    )
    print(f"csv={args.out_csv}")
    print(f"md={args.out_md}")
    print(f"rows={len(rows)}")


def format_count_map(values: dict[str, int], labels: dict[str, str] | None = None) -> str:
    parts: list[str] = []
    for key, count in sorted(values.items(), key=lambda item: (-item[1], item[0])):
        label = labels.get(key, key) if labels else key
        parts.append(f"{label}:{count}")
    return "; ".join(parts)


def collect_largest_file_usage(
    conn: sqlite3.Connection,
    limit: int,
    example_limit: int,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    group_rows = conn.execute(
        """
        SELECT
          sha256,
          MAX(size_bytes) AS size_bytes,
          COUNT(*) AS file_ref_count,
          COUNT(DISTINCT game_id) AS game_count,
          SUM(CASE WHEN storage_kind = 'blob' THEN 1 ELSE 0 END) AS blob_ref_count,
          SUM(CASE WHEN storage_kind = 'core_pack' THEN 1 ELSE 0 END) AS core_file_ref_count,
          MIN(id) AS first_file_id
        FROM files
        GROUP BY sha256
        ORDER BY size_bytes DESC, file_ref_count DESC, sha256
        LIMIT ?
        """,
        (limit,),
    ).fetchall()

    top_rows: list[dict[str, object]] = []
    reference_rows: list[dict[str, object]] = []
    for rank, group in enumerate(group_rows, start=1):
        refs = conn.execute(
            """
            SELECT
              f.id,
              f.game_id,
              g.root_path,
              f.rel_path,
              f.role,
              f.storage_kind,
              f.size_bytes,
              f.sha256,
              f.core_pack_sha256
            FROM files f
            JOIN games g ON g.id = f.game_id
            WHERE f.sha256 = ?
            ORDER BY g.root_path COLLATE NOCASE, f.rel_path COLLATE NOCASE
            """,
            (group["sha256"],),
        ).fetchall()
        role_counts: dict[str, int] = {}
        storage_counts: dict[str, int] = {}
        name_counts: dict[str, int] = {}
        ext_counts: dict[str, int] = {}
        example_paths: list[str] = []
        for ref in refs:
            role_counts[ref["role"]] = role_counts.get(ref["role"], 0) + 1
            storage_counts[ref["storage_kind"]] = storage_counts.get(ref["storage_kind"], 0) + 1
            rel = str(ref["rel_path"])
            name = PurePosixPath(rel).name
            suffix = PurePosixPath(rel).suffix.lower() or "(无扩展名)"
            name_counts[name] = name_counts.get(name, 0) + 1
            ext_counts[suffix] = ext_counts.get(suffix, 0) + 1
            if len(example_paths) < example_limit:
                example_paths.append(f"{ref['root_path']}/{rel}")
            reference_rows.append(
                {
                    "rank": rank,
                    "sha256": group["sha256"],
                    "size_bytes": int(group["size_bytes"]),
                    "file_id": int(ref["id"]),
                    "game_id": int(ref["game_id"]),
                    "root_path": ref["root_path"],
                    "rel_path": ref["rel_path"],
                    "role": ref["role"],
                    "storage_kind": ref["storage_kind"],
                    "core_pack_sha256": ref["core_pack_sha256"],
                }
            )

        blob_ref_count = int(group["blob_ref_count"] or 0)
        core_file_ref_count = int(group["core_file_ref_count"] or 0)
        size_bytes = int(group["size_bytes"])
        if int(group["file_ref_count"]) == 1:
            usage_status = "仅出现一次"
        else:
            usage_status = f"重复使用：{group['file_ref_count']} 个路径 / {group['game_count']} 个游戏"
        if blob_ref_count and core_file_ref_count:
            storage_status = "混合：blob 引用可复用，core 引用随 core pack 存储"
        elif blob_ref_count:
            storage_status = "独立 blob：R2 只需保存一份，重复路径复用同一对象"
        else:
            storage_status = "core 文件：随每个游戏的 core pack 存储，不作为独立 blob 去重"
        blob_saved_bytes = max(0, blob_ref_count - 1) * size_bytes
        top_rows.append(
            {
                "rank": rank,
                "sha256": group["sha256"],
                "size_bytes": size_bytes,
                "file_ref_count": int(group["file_ref_count"]),
                "game_count": int(group["game_count"]),
                "blob_ref_count": blob_ref_count,
                "core_file_ref_count": core_file_ref_count,
                "role_counts": role_counts,
                "storage_counts": storage_counts,
                "name_counts": name_counts,
                "ext_counts": ext_counts,
                "usage_status": usage_status,
                "storage_status": storage_status,
                "blob_saved_bytes": blob_saved_bytes,
                "example_paths": example_paths,
            }
        )
    return top_rows, reference_rows


def write_largest_file_usage_csv(
    top_rows: list[dict[str, object]],
    reference_rows: list[dict[str, object]],
    out_csv: Path,
    out_refs_csv: Path,
) -> None:
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with out_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "排名",
                "大小(Bytes)",
                "大小(易读)",
                "SHA-256",
                "文件引用数",
                "涉及游戏数",
                "Blob引用数",
                "Core文件引用数",
                "角色分布",
                "存储方式分布",
                "扩展名分布",
                "文件名分布",
                "使用状况",
                "存储状况",
                "Blob去重节省估算(Bytes)",
                "Blob去重节省估算(易读)",
                "示例路径",
            ]
        )
        for row in top_rows:
            writer.writerow(
                [
                    row["rank"],
                    row["size_bytes"],
                    human_bytes(row["size_bytes"]),
                    row["sha256"],
                    row["file_ref_count"],
                    row["game_count"],
                    row["blob_ref_count"],
                    row["core_file_ref_count"],
                    format_count_map(row["role_counts"], ROLE_LABELS),
                    format_count_map(row["storage_counts"], STORAGE_LABELS),
                    format_count_map(row["ext_counts"]),
                    format_count_map(row["name_counts"]),
                    row["usage_status"],
                    row["storage_status"],
                    row["blob_saved_bytes"],
                    human_bytes(row["blob_saved_bytes"]),
                    " ; ".join(row["example_paths"]),
                ]
            )

    out_refs_csv.parent.mkdir(parents=True, exist_ok=True)
    with out_refs_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "排名",
                "SHA-256",
                "大小(Bytes)",
                "大小(易读)",
                "文件记录ID",
                "游戏ID",
                "游戏路径",
                "文件相对路径",
                "角色",
                "存储方式",
                "Core Pack SHA-256",
            ]
        )
        for row in reference_rows:
            writer.writerow(
                [
                    row["rank"],
                    row["sha256"],
                    row["size_bytes"],
                    human_bytes(row["size_bytes"]),
                    row["file_id"],
                    row["game_id"],
                    row["root_path"],
                    row["rel_path"],
                    ROLE_LABELS.get(str(row["role"]), row["role"]),
                    STORAGE_LABELS.get(str(row["storage_kind"]), row["storage_kind"]),
                    row["core_pack_sha256"] or "",
                ]
            )


def render_largest_file_usage_markdown(
    top_rows: list[dict[str, object]],
    out_csv: Path,
    out_refs_csv: Path,
) -> str:
    total_size = sum(int(row["size_bytes"]) for row in top_rows)
    total_blob_saved = sum(int(row["blob_saved_bytes"]) for row in top_rows)
    duplicate_rows = sum(1 for row in top_rows if int(row["file_ref_count"]) > 1)
    lines = [
        "# RPG Maker 2000/2003 最大文件 Top 100 使用状况",
        "",
        f"Generated: {now_iso()}",
        "",
        "## 口径",
        "",
        f"- 主 CSV: `{out_csv}`",
        f"- 引用明细 CSV: `{out_refs_csv}`",
        "- 排名按唯一文件内容的大小排序，即同一 SHA-256 只列一次。",
        "- `文件引用数` 是这个内容在已接受游戏中出现了多少个文件路径。",
        "- `Blob去重节省估算` 只计算独立 blob 的重复引用节省；core 文件随 core pack 处理，不在这里按单文件估算。",
        "",
        "## 总览",
        "",
        f"- 列出唯一文件内容: {len(top_rows)} 个",
        f"- 这些唯一内容单份合计大小: {human_bytes(total_size)}",
        f"- 其中重复出现的内容: {duplicate_rows} 个",
        f"- Top 100 内 blob 重复引用节省估算: {human_bytes(total_blob_saved)}",
        "",
        "## Top 100",
        "",
        "| 排名 | 大小 | 引用/游戏 | 角色 | 存储方式 | 使用状况 | Blob节省 | 示例路径 |",
        "|---:|---:|---:|---|---|---|---:|---|",
    ]
    for row in top_rows:
        roles = format_count_map(row["role_counts"], ROLE_LABELS).replace("|", "/")
        storages = format_count_map(row["storage_counts"], STORAGE_LABELS).replace("|", "/")
        example = str(row["example_paths"][0]).replace("|", "/") if row["example_paths"] else ""
        lines.append(
            f"| {row['rank']} | {human_bytes(row['size_bytes'])} | "
            f"{row['file_ref_count']} / {row['game_count']} | {roles} | {storages} | "
            f"{row['usage_status']} | {human_bytes(row['blob_saved_bytes'])} | `{example}` |"
        )
    return "\n".join(lines) + "\n"


def command_export_largest_files(args: argparse.Namespace) -> None:
    conn = connect(args.workspace)
    top_rows, reference_rows = collect_largest_file_usage(conn, args.limit, args.example_limit)
    write_largest_file_usage_csv(top_rows, reference_rows, args.out_csv, args.out_refs_csv)
    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.write_text(
        render_largest_file_usage_markdown(top_rows, args.out_csv, args.out_refs_csv),
        encoding="utf-8",
    )
    print(f"csv={args.out_csv}")
    print(f"refs_csv={args.out_refs_csv}")
    print(f"md={args.out_md}")
    print(f"rows={len(top_rows)}")
    print(f"reference_rows={len(reference_rows)}")


def collect_file_type_rows(
    conn: sqlite3.Connection,
    include_over_limit: bool,
    example_limit: int,
) -> list[dict[str, object]]:
    statuses = summary_statuses(include_over_limit)
    rows = conn.execute(
        f"""
        SELECT
          f.rel_path,
          f.role,
          f.storage_kind,
          f.size_bytes,
          f.sha256,
          g.id AS game_id,
          g.root_path
        FROM files f
        JOIN games g ON g.id = f.game_id
        WHERE g.status IN ({placeholders(statuses)})
        ORDER BY f.size_bytes DESC, g.root_path COLLATE NOCASE, f.rel_path COLLATE NOCASE
        """,
        statuses,
    ).fetchall()

    groups: dict[str, dict[str, object]] = {}
    unique_seen: dict[str, set[str]] = {}
    for row in rows:
        type_key = file_type_key(row["rel_path"])
        group = groups.setdefault(
            type_key,
            {
                "type_key": type_key,
                "file_count": 0,
                "game_ids": set(),
                "raw_bytes": 0,
                "unique_bytes": 0,
                "role_counts": {},
                "storage_counts": {},
                "top_dir_counts": {},
                "examples": [],
                "largest_file_bytes": 0,
            },
        )
        group["file_count"] = int(group["file_count"]) + 1
        group["raw_bytes"] = int(group["raw_bytes"]) + int(row["size_bytes"])
        group["largest_file_bytes"] = max(int(group["largest_file_bytes"]), int(row["size_bytes"]))
        group["game_ids"].add(int(row["game_id"]))
        role_counts = group["role_counts"]
        assert isinstance(role_counts, dict)
        role_counts[row["role"]] = role_counts.get(row["role"], 0) + 1
        storage_counts = group["storage_counts"]
        assert isinstance(storage_counts, dict)
        storage_counts[row["storage_kind"]] = storage_counts.get(row["storage_kind"], 0) + 1
        top_dir_counts = group["top_dir_counts"]
        assert isinstance(top_dir_counts, dict)
        top_dir = top_level_dir(row["rel_path"])
        top_dir_counts[top_dir] = top_dir_counts.get(top_dir, 0) + 1
        seen = unique_seen.setdefault(type_key, set())
        if row["sha256"] not in seen:
            seen.add(row["sha256"])
            group["unique_bytes"] = int(group["unique_bytes"]) + int(row["size_bytes"])
        examples = group["examples"]
        assert isinstance(examples, list)
        if len(examples) < example_limit:
            examples.append(f"{row['root_path']}/{row['rel_path']}")

    result: list[dict[str, object]] = []
    for type_key, group in groups.items():
        role_counts = group["role_counts"]
        assert isinstance(role_counts, dict)
        action, reason = whitelist_status(type_key)
        game_ids = group["game_ids"]
        assert isinstance(game_ids, set)
        top_dir_counts = group["top_dir_counts"]
        assert isinstance(top_dir_counts, dict)
        top_dirs = set(top_dir_counts)
        static_only = bool(top_dirs) and top_dirs <= STATIC_RESOURCE_DIRS
        result.append(
            {
                "type_key": type_key,
                "file_count": int(group["file_count"]),
                "game_count": len(game_ids),
                "raw_bytes": int(group["raw_bytes"]),
                "unique_count": len(unique_seen[type_key]),
                "unique_bytes": int(group["unique_bytes"]),
                "largest_file_bytes": int(group["largest_file_bytes"]),
                "role_counts": role_counts,
                "storage_counts": group["storage_counts"],
                "top_dir_counts": top_dir_counts,
                "static_resource_only": static_only,
                "static_candidate_note": static_candidate_note(type_key) if action == "白名单外" and static_only else "",
                "examples": group["examples"],
                "whitelist_status": action,
                "reason": reason,
            }
        )
    return sorted(result, key=lambda item: (-int(item["raw_bytes"]), str(item["type_key"])))


def write_file_types_csv(rows: list[dict[str, object]], out_csv: Path) -> None:
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with out_csv.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "文件类型",
                "文件数",
                "涉及游戏数",
                "原始大小(Bytes)",
                "原始大小(易读)",
                "唯一内容数",
                "唯一内容大小(Bytes)",
                "唯一内容大小(易读)",
                "最大单文件(Bytes)",
                "最大单文件(易读)",
                "角色分布",
                "存储方式分布",
                "顶层目录分布",
                "是否只在静态资源目录",
                "强制白名单状态",
                "处理说明",
                "静态目录候选判断",
                "示例路径",
            ]
        )
        for row in rows:
            writer.writerow(
                [
                    row["type_key"],
                    row["file_count"],
                    row["game_count"],
                    row["raw_bytes"],
                    human_bytes(row["raw_bytes"]),
                    row["unique_count"],
                    row["unique_bytes"],
                    human_bytes(row["unique_bytes"]),
                    row["largest_file_bytes"],
                    human_bytes(row["largest_file_bytes"]),
                    format_count_map(row["role_counts"], ROLE_LABELS),
                    format_count_map(row["storage_counts"], STORAGE_LABELS),
                    format_count_map(row["top_dir_counts"]),
                    "是" if row["static_resource_only"] else "否",
                    row["whitelist_status"],
                    row["reason"],
                    row["static_candidate_note"],
                    " ; ".join(row["examples"]),
                ]
            )


def render_file_types_markdown(rows: list[dict[str, object]], out_csv: Path, include_over_limit: bool) -> str:
    total_files = sum(int(row["file_count"]) for row in rows)
    total_raw = sum(int(row["raw_bytes"]) for row in rows)
    total_unique = sum(int(row["unique_bytes"]) for row in rows)
    by_status: dict[str, dict[str, int]] = {}
    for row in rows:
        status = str(row["whitelist_status"])
        bucket = by_status.setdefault(status, {"types": 0, "files": 0, "raw": 0, "unique": 0})
        bucket["types"] += 1
        bucket["files"] += int(row["file_count"])
        bucket["raw"] += int(row["raw_bytes"])
        bucket["unique"] += int(row["unique_bytes"])

    lines = [
        "# RPG Maker 2000/2003 已收录文件类型分析",
        "",
        f"Generated: {now_iso()}",
        "",
        "## 口径",
        "",
        f"- 完整 CSV: `{out_csv}`",
        "- 统计对象: 当前 SQLite 中已经完整哈希并写入 `files` 表的文件。",
        f"- 是否包含 `scanned_over_limit`: {'是' if include_over_limit else '否'}。",
        "- 文件类型按扩展名聚合；分卷包会折叠为 `.7z.###`、`.z##` 等模式。",
        "- 扫描规则使用单一强制白名单：不在白名单内的文件类型直接排除。",
        "",
        "## 总览",
        "",
        f"- 文件类型数: {len(rows)}",
        f"- 文件数: {total_files}",
        f"- 原始大小: {human_bytes(total_raw)}",
        f"- 唯一内容大小合计: {human_bytes(total_unique)}",
        "",
        "## 强制白名单汇总",
        "",
        "| 状态 | 类型数 | 文件数 | 原始大小 | 唯一内容大小 |",
        "|---|---:|---:|---:|---:|",
    ]
    for status, bucket in sorted(by_status.items(), key=lambda item: (-item[1]["raw"], item[0])):
        lines.append(
            f"| {status} | {bucket['types']} | {bucket['files']} | "
            f"{human_bytes(bucket['raw'])} | {human_bytes(bucket['unique'])} |"
        )

    def type_list(status: str) -> str:
        values = [str(row["type_key"]) for row in rows if row["whitelist_status"] == status]
        return ", ".join(f"`{value}`" for value in values) if values else "(无)"

    outside_static_rows = [
        row for row in rows if row["whitelist_status"] == "白名单外" and row["static_resource_only"]
    ]
    lines.extend(
        [
            "",
            "## 强制白名单",
            "",
            ", ".join(f"`{value}`" for value in sorted(ALLOWED_FILE_TYPE_KEYS)),
            "",
            "## 当前样本中的命中情况",
            "",
            f"- 白名单内: {type_list('白名单内')}",
            f"- 白名单外: {type_list('白名单外')}",
            "",
            "## 白名单外且只在静态资源目录",
            "",
            "| 文件类型 | 文件数 | 游戏数 | 原始大小 | 顶层目录 | 判断 | 示例路径 |",
            "|---|---:|---:|---:|---|---|---|",
        ]
    )
    if outside_static_rows:
        for row in outside_static_rows:
            dirs = format_count_map(row["top_dir_counts"]).replace("|", "/")
            examples = row["examples"]
            assert isinstance(examples, list)
            example = str(examples[0]).replace("|", "/") if examples else ""
            lines.append(
                f"| `{row['type_key']}` | {row['file_count']} | {row['game_count']} | "
                f"{human_bytes(row['raw_bytes'])} | {dirs} | {row['static_candidate_note']} | `{example}` |"
            )
    else:
        lines.append("| (无) | 0 | 0 | 0 B |  |  |  |")
    lines.extend(
        [
            "",
            "## 按体积排序",
            "",
            "| 文件类型 | 文件数 | 游戏数 | 原始大小 | 唯一内容 | 最大单文件 | 角色 | 顶层目录 | 静态目录限定 | 状态 | 示例路径 |",
            "|---|---:|---:|---:|---:|---:|---|---|---|---|---|",
        ]
    )
    for row in rows:
        roles = format_count_map(row["role_counts"], ROLE_LABELS).replace("|", "/")
        examples = row["examples"]
        assert isinstance(examples, list)
        example = str(examples[0]).replace("|", "/") if examples else ""
        dirs = format_count_map(row["top_dir_counts"]).replace("|", "/")
        lines.append(
            f"| `{row['type_key']}` | {row['file_count']} | {row['game_count']} | "
            f"{human_bytes(row['raw_bytes'])} | {human_bytes(row['unique_bytes'])} | "
            f"{human_bytes(row['largest_file_bytes'])} | {roles} | {dirs} | "
            f"{'是' if row['static_resource_only'] else '否'} | {row['whitelist_status']} | `{example}` |"
        )
    return "\n".join(lines) + "\n"


def command_export_file_types(args: argparse.Namespace) -> None:
    conn = connect(args.workspace)
    rows = collect_file_type_rows(conn, args.include_over_limit, args.example_limit)
    write_file_types_csv(rows, args.out_csv)
    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.write_text(
        render_file_types_markdown(rows, args.out_csv, args.include_over_limit),
        encoding="utf-8",
    )
    print(f"csv={args.out_csv}")
    print(f"md={args.out_md}")
    print(f"types={len(rows)}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workspace",
        type=Path,
        default=default_workspace(),
        help="SQLite workspace path.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    discover = sub.add_parser("discover", help="Discover RPG_RT.ini game roots.")
    discover.add_argument("--root", type=Path, default=Path("D:\\"), help="Root drive/folder to scan.")
    discover.add_argument("--ini-name", default="RPG_RT.ini", help="INI file name to discover.")
    discover.set_defaults(func=command_discover)

    scan = sub.add_parser("scan", help="Scan pending games with exact SHA-256 hashes.")
    scan.add_argument("--limit", type=int, default=1, help="Maximum games to scan this run. Use 0 for all.")
    scan.add_argument("--force", action="store_true", help="Rescan already scanned/rejected games.")
    scan.add_argument(
        "--include-over-limit",
        action="store_true",
        help="Hash over-limit games completely and mark them as scanned_over_limit instead of rejecting early.",
    )
    scan.add_argument("--path-contains", help="Only scan roots containing this substring.")
    scan.set_defaults(func=command_scan)

    status = sub.add_parser("status", help="Show workspace status.")
    status.set_defaults(func=command_status)

    list_cmd = sub.add_parser("list", help="List games.")
    list_cmd.add_argument("--status", choices=["discovered", "scanned", "scanned_over_limit", "rejected_limit", "error"])
    list_cmd.add_argument("--limit", type=int, default=50)
    list_cmd.set_defaults(func=command_list)

    report = sub.add_parser("report", help="Generate exact cost/effect report.")
    report.add_argument("--out-md", type=Path, default=default_reports_dir() / "rpg-maker-exact-scan-report.md")
    report.add_argument("--out-json", type=Path, default=default_reports_dir() / "rpg-maker-exact-scan-report.json")
    report.add_argument(
        "--include-over-limit",
        action="store_true",
        help="Include status=scanned_over_limit games in report calculations.",
    )
    report.set_defaults(func=command_report)

    export_files = sub.add_parser("export-files", help="Export Chinese per-file analysis reports.")
    export_files.add_argument(
        "--out-csv",
        type=Path,
        default=default_reports_dir() / "file-detail.zh-CN.csv",
    )
    export_files.add_argument(
        "--out-md",
        type=Path,
        default=default_reports_dir() / "file-analysis.zh-CN.md",
    )
    export_files.add_argument("--duplicate-limit", type=int, default=50)
    export_files.set_defaults(func=command_export_files)

    export_games = sub.add_parser("export-games", help="Export Chinese per-game size/compression reports.")
    export_games.add_argument(
        "--out-csv",
        type=Path,
        default=default_reports_dir() / "game-size-compression.zh-CN.csv",
    )
    export_games.add_argument(
        "--out-md",
        type=Path,
        default=default_reports_dir() / "game-size-compression.zh-CN.md",
    )
    export_games.add_argument(
        "--markdown-limit",
        type=int,
        default=0,
        help="Rows to include in Markdown. Use 0 for all games.",
    )
    export_games.add_argument(
        "--include-over-limit",
        action="store_true",
        help="Include status=scanned_over_limit games in game compression report.",
    )
    export_games.set_defaults(func=command_export_games)

    export_largest_files = sub.add_parser(
        "export-largest-files",
        help="Export the largest unique file contents and their usage status.",
    )
    export_largest_files.add_argument("--limit", type=int, default=100)
    export_largest_files.add_argument("--example-limit", type=int, default=8)
    export_largest_files.add_argument(
        "--out-csv",
        type=Path,
        default=default_reports_dir() / "largest-files-usage-top100.zh-CN.csv",
    )
    export_largest_files.add_argument(
        "--out-refs-csv",
        type=Path,
        default=default_reports_dir() / "largest-files-usage-top100-references.zh-CN.csv",
    )
    export_largest_files.add_argument(
        "--out-md",
        type=Path,
        default=default_reports_dir() / "largest-files-usage-top100.zh-CN.md",
    )
    export_largest_files.set_defaults(func=command_export_largest_files)

    export_file_types = sub.add_parser(
        "export-file-types",
        help="Export observed file type statistics against the forced whitelist.",
    )
    export_file_types.add_argument("--example-limit", type=int, default=5)
    export_file_types.add_argument(
        "--include-over-limit",
        action="store_true",
        help="Include status=scanned_over_limit games in file type statistics.",
    )
    export_file_types.add_argument(
        "--out-csv",
        type=Path,
        default=default_reports_dir() / "file-types-whitelist-analysis.zh-CN.csv",
    )
    export_file_types.add_argument(
        "--out-md",
        type=Path,
        default=default_reports_dir() / "file-types-whitelist-analysis.zh-CN.md",
    )
    export_file_types.set_defaults(func=command_export_file_types)

    return parser


def main(argv: Iterable[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
