#!/usr/bin/env python3
"""Controlled RPG Maker 2000/2003 archive importer for staging trials."""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import datetime as dt
import hashlib
import hmac
import json
import mimetypes
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable


FILE_POLICY_VERSION = "rpgm2000-2003-whitelist-v2"

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

CORE_EXACT_NAMES = {"rpg_rt.ldb", "rpg_rt.lmt", "rpg_rt.ini"}
RUNTIME_EXTS = {".exe", ".dll"}
STRING_SCRIPT_DIRS = {"stringscripts", "stringscripts_origin"}

CONTENT_TYPES = {
    ".avi": "video/x-msvideo",
    ".bmp": "image/bmp",
    ".dll": "application/octet-stream",
    ".exe": "application/octet-stream",
    ".flac": "audio/flac",
    ".fon": "application/octet-stream",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".ini": "text/plain; charset=utf-8",
    ".jpg": "image/jpeg",
    ".ldb": "application/octet-stream",
    ".lmt": "application/octet-stream",
    ".lmu": "application/octet-stream",
    ".mid": "audio/midi",
    ".midi": "audio/midi",
    ".mpeg": "video/mpeg",
    ".mp3": "audio/mpeg",
    ".mpg": "video/mpeg",
    ".oga": "audio/ogg",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".otf": "font/otf",
    ".png": "image/png",
    ".ttc": "font/collection",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".wav": "audio/wav",
    ".wma": "audio/x-ms-wma",
    ".xyz": "image/x-rpg-maker-xyz",
}

WORKSPACE_ROOT = Path("tools/rpgm-archive-importer/workspace")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")


@dataclass(frozen=True)
class FileEntry:
    rel_path: str
    abs_path: Path
    role: str
    storage_kind: str
    sha256: str
    size_bytes: int
    mtime_ms: int
    content_type_hint: str
    observed_ext: str
    pack_entry_path: str | None = None


@dataclass(frozen=True)
class ExcludedGroup:
    file_type: str
    file_count: int
    total_size_bytes: int
    example_path: str


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: object, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(value, ensure_ascii=False, indent=2)
    path.write_text(text + "\n", encoding="utf-8")


def repo_root() -> Path:
    return Path.cwd()


def default_config() -> Path:
    return Path("tools/rpgm-archive-importer/samples/tokyo-butouhen-ova.staging.json")


def run_dir(run_id: str) -> Path:
    return WORKSPACE_ROOT / run_id


def human_bytes(value: int | float) -> str:
    n = float(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.2f} {unit}"
        n /= 1024
    raise AssertionError("unreachable")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_type_key(name: str) -> str:
    lower = PurePosixPath(name).name.lower()
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
    return PurePosixPath(lower).suffix or "(no-extension)"


def is_core_file(rel_path: str) -> bool:
    name = PurePosixPath(rel_path).name.lower()
    return name in CORE_EXACT_NAMES or (
        name.startswith("map")
        and name.endswith(".lmu")
        and len(name) == len("map0001.lmu")
        and name[3:7].isdigit()
    )


def is_string_script_txt(rel_path: str) -> bool:
    parts = PurePosixPath(rel_path).parts
    if len(parts) < 2:
        return False
    return parts[0].lower() in STRING_SCRIPT_DIRS and PurePosixPath(rel_path).suffix.lower() == ".txt"


def is_core_pack_file(rel_path: str) -> bool:
    return is_core_file(rel_path) or is_string_script_txt(rel_path)


def forced_exclusion_type(rel_path: str) -> str | None:
    path = PurePosixPath(rel_path)
    parts = path.parts
    if not parts:
        return "invalid-path"
    top = parts[0].lower()
    name = path.name.lower()
    if top in STRING_SCRIPT_DIRS and path.suffix.lower() != ".txt":
        return "string-scripts-non-txt"
    if top == "screenshots":
        return "screenshots-dir"
    if len(parts) == 1 and "screenshot" in name:
        return "root-screenshot-file"
    return None


def role_for(rel_path: str, metadata_paths: set[str]) -> str:
    if is_core_file(rel_path):
        name = PurePosixPath(rel_path).name.lower()
        return "map" if name.endswith(".lmu") else "database"
    if is_string_script_txt(rel_path):
        return "other"
    if rel_path in metadata_paths:
        return "metadata"
    if PurePosixPath(rel_path).suffix.lower() in RUNTIME_EXTS:
        return "runtime"
    return "asset"


def blob_key(sha256: str) -> str:
    return f"blobs/sha256/{sha256[:2]}/{sha256[2:4]}/{sha256}"


def core_pack_key(sha256: str) -> str:
    return f"core-packs/sha256/{sha256[:2]}/{sha256[2:4]}/{sha256}.zip"


def manifest_key(sha256: str) -> str:
    return f"manifests/sha256/{sha256[:2]}/{sha256[2:4]}/{sha256}.json"


def content_type_for(path: str) -> str:
    ext = PurePosixPath(path).suffix.lower()
    if ext in CONTENT_TYPES:
        return CONTENT_TYPES[ext]
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


def scan_source(root: Path, config: dict) -> tuple[list[FileEntry], list[ExcludedGroup], dict[str, int]]:
    metadata_paths = {item["path"].replace("\\", "/") for item in config.get("mediaAssets", [])}
    included: list[FileEntry] = []
    excluded_by_type: dict[str, dict[str, object]] = {}
    source_file_count = 0
    source_size_bytes = 0

    files = [path for path in root.rglob("*") if path.is_file()]
    files.sort(key=lambda path: path.relative_to(root).as_posix().lower())

    for path in files:
        stat = path.stat()
        rel_path = path.relative_to(root).as_posix()
        size = int(stat.st_size)
        source_file_count += 1
        source_size_bytes += size
        forced_exclusion = forced_exclusion_type(rel_path)
        type_key = file_type_key(path.name)

        if forced_exclusion is not None or type_key not in ALLOWED_FILE_TYPE_KEYS:
            group_key = forced_exclusion or type_key
            group = excluded_by_type.setdefault(
                group_key,
                {
                    "file_count": 0,
                    "total_size_bytes": 0,
                    "example_path": rel_path,
                },
            )
            group["file_count"] = int(group["file_count"]) + 1
            group["total_size_bytes"] = int(group["total_size_bytes"]) + size
            continue

        role = role_for(rel_path, metadata_paths)
        storage_kind = "core_pack" if is_core_pack_file(rel_path) else "blob"
        included.append(
            FileEntry(
                rel_path=rel_path,
                abs_path=path,
                role=role,
                storage_kind=storage_kind,
                sha256=sha256_file(path),
                size_bytes=size,
                mtime_ms=int(stat.st_mtime * 1000),
                content_type_hint=content_type_for(rel_path),
                observed_ext=PurePosixPath(rel_path).suffix.lower() or None,
                pack_entry_path=rel_path if storage_kind == "core_pack" else None,
            )
        )

    excluded = [
        ExcludedGroup(
            file_type=file_type,
            file_count=int(values["file_count"]),
            total_size_bytes=int(values["total_size_bytes"]),
            example_path=str(values["example_path"]),
        )
        for file_type, values in sorted(
            excluded_by_type.items(),
            key=lambda item: (-int(item[1]["total_size_bytes"]), item[0]),
        )
    ]
    stats = {
        "source_file_count": source_file_count,
        "source_size_bytes": source_size_bytes,
        "excluded_file_count": sum(group.file_count for group in excluded),
        "excluded_size_bytes": sum(group.total_size_bytes for group in excluded),
    }
    return included, excluded, stats


def create_core_pack(entries: list[FileEntry], out_path: Path) -> tuple[str, int]:
    core_entries = [entry for entry in entries if entry.storage_kind == "core_pack"]
    core_entries.sort(key=lambda entry: entry.rel_path.lower())
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as zf:
        for entry in core_entries:
            info = zipfile.ZipInfo.from_file(entry.abs_path, arcname=entry.rel_path)
            info.compress_type = zipfile.ZIP_DEFLATED
            info._compresslevel = 1
            with entry.abs_path.open("rb") as handle:
                zf.writestr(info, handle.read())

    return sha256_file(out_path), out_path.stat().st_size


def unique_blob_entries(entries: list[FileEntry]) -> dict[str, FileEntry]:
    result: dict[str, FileEntry] = {}
    for entry in entries:
        if entry.storage_kind != "blob":
            continue
        existing = result.get(entry.sha256)
        if existing is None or entry.rel_path.lower() < existing.rel_path.lower():
            result[entry.sha256] = entry
    return result


def build_manifest(
    config: dict,
    entries: list[FileEntry],
    stats: dict[str, int],
    core_pack_sha256: str,
    core_pack_size: int,
) -> dict:
    core_entries = [entry for entry in entries if entry.storage_kind == "core_pack"]
    core_raw_size = sum(entry.size_bytes for entry in core_entries)
    archive_config = config["archiveVersion"]
    created_at = now_iso()

    files = []
    for entry in sorted(entries, key=lambda item: item.rel_path.lower()):
        storage: dict[str, object]
        if entry.storage_kind == "core_pack":
            storage = {
                "kind": "core_pack",
                "packId": "core-main",
                "entry": entry.pack_entry_path,
            }
        else:
            storage = {
                "kind": "blob",
                "blobSha256": entry.sha256,
            }
        files.append(
            {
                "path": entry.rel_path,
                "pathSortKey": entry.rel_path.lower(),
                "role": entry.role,
                "sha256": entry.sha256,
                "size": entry.size_bytes,
                "mtimeMs": entry.mtime_ms,
                "storage": storage,
            }
        )

    return {
        "schema": "viprpg-archive.manifest.v1",
        "work": {
            "slug": config["work"]["slug"],
            "title": config["work"]["primaryTitle"],
            "originalTitle": config["work"].get("originalTitle"),
        },
        "release": {
            "label": config["release"]["label"],
            "type": config["release"]["type"],
            "language": config["release"].get("language"),
        },
        "archiveVersion": {
            "label": archive_config["label"],
            "createdAt": created_at,
            "filePolicyVersion": config.get("filePolicyVersion", FILE_POLICY_VERSION),
            "packerVersion": config["packerVersion"],
            "sourceType": archive_config["sourceType"],
            "sourceName": archive_config["sourceName"],
            "sourceFileCount": stats["source_file_count"],
            "sourceSize": stats["source_size_bytes"],
            "includedFileCount": len(entries),
            "includedSize": sum(entry.size_bytes for entry in entries),
            "excludedFileCount": stats["excluded_file_count"],
            "excludedSize": stats["excluded_size_bytes"],
        },
        "corePacks": [
            {
                "id": "core-main",
                "sha256": core_pack_sha256,
                "size": core_pack_size,
                "uncompressedSize": core_raw_size,
                "fileCount": len(core_entries),
                "format": "zip",
                "compression": "deflate-low",
            }
        ],
        "files": files,
    }


def sql_quote(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def json_sql(value: object) -> str:
    return sql_quote(json.dumps(value if value is not None else {}, ensure_ascii=False, separators=(",", ":")))


def work_id(config: dict) -> str:
    return f"(SELECT id FROM works WHERE slug = {sql_quote(config['work']['slug'])})"


def release_id(config: dict) -> str:
    return (
        "(SELECT r.id FROM releases r "
        f"JOIN works w ON w.id = r.work_id WHERE w.slug = {sql_quote(config['work']['slug'])} "
        f"AND r.release_label = {sql_quote(config['release']['label'])})"
    )


def archive_version_id(config: dict, manifest_sha256: str) -> str:
    return (
        "(SELECT av.id FROM archive_versions av "
        f"WHERE av.release_id = {release_id(config)} "
        f"AND av.manifest_sha256 = {sql_quote(manifest_sha256)})"
    )


def core_pack_id(sha256: str) -> str:
    return f"(SELECT id FROM core_packs WHERE sha256 = {sql_quote(sha256)})"


def tag_id(slug: str) -> str:
    return f"(SELECT id FROM tags WHERE slug = {sql_quote(slug)})"


def creator_id(slug: str) -> str:
    return f"(SELECT id FROM creators WHERE slug = {sql_quote(slug)})"


def event_id(slug: str) -> str:
    return f"(SELECT id FROM events WHERE slug = {sql_quote(slug)})"


def import_job_id(config: dict, manifest_sha256: str) -> str:
    return (
        "(SELECT id FROM import_jobs "
        f"WHERE archive_version_id = {archive_version_id(config, manifest_sha256)} "
        "ORDER BY id DESC LIMIT 1)"
    )


def build_sql(
    config: dict,
    entries: list[FileEntry],
    excluded: list[ExcludedGroup],
    manifest_sha256: str,
    manifest_r2_key: str,
    core_pack_sha256: str,
    core_pack_size: int,
    stats: dict[str, int],
) -> str:
    work = config["work"]
    release = config["release"]
    archive = config["archiveVersion"]
    core_entries = [entry for entry in entries if entry.storage_kind == "core_pack"]
    blobs = unique_blob_entries(entries)
    included_size = sum(entry.size_bytes for entry in entries)
    blob_unique_size = sum(entry.size_bytes for entry in blobs.values())
    estimated_r2_get_count = 1 + len(blobs)
    published_at = "CURRENT_TIMESTAMP" if work.get("status") == "published" else "NULL"
    lines: list[str] = [
        "PRAGMA foreign_keys = ON;",
    ]

    lines.append(
        """
INSERT OR IGNORE INTO works (
  slug, primary_title, original_title, sort_title, description,
  original_release_date, original_release_precision, engine_family, engine_detail,
  status, extra_json, published_at
) VALUES (
  {slug}, {primary_title}, {original_title}, {sort_title}, {description},
  {original_release_date}, {original_release_precision}, {engine_family}, {engine_detail},
  {status}, {extra_json}, {published_at}
);
""".format(
            slug=sql_quote(work["slug"]),
            primary_title=sql_quote(work["primaryTitle"]),
            original_title=sql_quote(work.get("originalTitle")),
            sort_title=sql_quote(work.get("sortTitle")),
            description=sql_quote(work.get("description")),
            original_release_date=sql_quote(work.get("originalReleaseDate")),
            original_release_precision=sql_quote(work.get("originalReleasePrecision", "unknown")),
            engine_family=sql_quote(work.get("engineFamily", "unknown")),
            engine_detail=sql_quote(work.get("engineDetail")),
            status=sql_quote(work.get("status", "draft")),
            extra_json=json_sql(work.get("extra", {})),
            published_at=published_at,
        ).strip()
    )

    for title in config.get("workTitles", []):
        lines.append(
            """
INSERT OR IGNORE INTO work_titles (
  work_id, title, language, title_type, is_searchable
) VALUES (
  {work_id}, {title}, {language}, {title_type}, 1
);
""".format(
                work_id=work_id(config),
                title=sql_quote(title["title"]),
                language=sql_quote(title.get("language")),
                title_type=sql_quote(title["titleType"]),
            ).strip()
        )

    for creator in config.get("creators", []):
        lines.append(
            """
INSERT OR IGNORE INTO creators (
  slug, name, original_name, website_url, extra_json
) VALUES (
  {slug}, {name}, {original_name}, {website_url}, {extra_json}
);
""".format(
                slug=sql_quote(creator["slug"]),
                name=sql_quote(creator["name"]),
                original_name=sql_quote(creator.get("originalName")),
                website_url=sql_quote(creator.get("websiteUrl")),
                extra_json=json_sql(creator.get("extra", {})),
            ).strip()
        )
        for staff in creator.get("workStaff", []):
            lines.append(
                """
INSERT OR IGNORE INTO work_staff (
  work_id, creator_id, role_key, role_label, notes
) VALUES (
  {work_id}, {creator_id}, {role_key}, {role_label}, {notes}
);
""".format(
                    work_id=work_id(config),
                    creator_id=creator_id(creator["slug"]),
                    role_key=sql_quote(staff["roleKey"]),
                    role_label=sql_quote(staff.get("roleLabel")),
                    notes=sql_quote(staff.get("notes")),
                ).strip()
            )

    for tag in config.get("tags", []):
        lines.append(
            """
INSERT OR IGNORE INTO tags (
  slug, name, namespace, description
) VALUES (
  {slug}, {name}, {namespace}, {description}
);
""".format(
                slug=sql_quote(tag["slug"]),
                name=sql_quote(tag["name"]),
                namespace=sql_quote(tag.get("namespace", "other")),
                description=sql_quote(tag.get("description")),
            ).strip()
        )
        if tag.get("target") == "work":
            lines.append(
                f"INSERT OR IGNORE INTO work_tags (work_id, tag_id, source) "
                f"VALUES ({work_id(config)}, {tag_id(tag['slug'])}, 'imported');"
            )

    release_published_at = "CURRENT_TIMESTAMP" if release.get("status") == "published" else "NULL"
    lines.append(
        """
INSERT OR IGNORE INTO releases (
  work_id, release_label, release_type, language, release_date, release_date_precision,
  source_name, source_url, uses_maniacs_patch, is_proofread, is_image_edited,
  executable_path, rights_notes, status, extra_json, published_at
) VALUES (
  {work_id}, {release_label}, {release_type}, {language}, {release_date}, {release_date_precision},
  {source_name}, {source_url}, {uses_maniacs_patch}, {is_proofread}, {is_image_edited},
  {executable_path}, {rights_notes}, {status}, {extra_json}, {published_at}
);
""".format(
            work_id=work_id(config),
            release_label=sql_quote(release["label"]),
            release_type=sql_quote(release["type"]),
            language=sql_quote(release.get("language")),
            release_date=sql_quote(release.get("releaseDate")),
            release_date_precision=sql_quote(release.get("releaseDatePrecision", "unknown")),
            source_name=sql_quote(release.get("sourceName")),
            source_url=sql_quote(release.get("sourceUrl")),
            uses_maniacs_patch=sql_quote(bool(release.get("usesManiacsPatch"))),
            is_proofread=sql_quote(bool(release.get("isProofread"))),
            is_image_edited=sql_quote(bool(release.get("isImageEdited"))),
            executable_path=sql_quote(release.get("executablePath")),
            rights_notes=sql_quote(release.get("rightsNotes")),
            status=sql_quote(release.get("status", "draft")),
            extra_json=json_sql(release.get("extra", {})),
            published_at=release_published_at,
        ).strip()
    )

    for creator in config.get("creators", []):
        for staff in creator.get("releaseStaff", []):
            lines.append(
                """
INSERT OR IGNORE INTO release_staff (
  release_id, creator_id, role_key, role_label, notes
) VALUES (
  {release_id}, {creator_id}, {role_key}, {role_label}, {notes}
);
""".format(
                    release_id=release_id(config),
                    creator_id=creator_id(creator["slug"]),
                    role_key=sql_quote(staff["roleKey"]),
                    role_label=sql_quote(staff.get("roleLabel")),
                    notes=sql_quote(staff.get("notes")),
                ).strip()
            )

    for tag in config.get("tags", []):
        if tag.get("target") == "release":
            lines.append(
                f"INSERT OR IGNORE INTO release_tags (release_id, tag_id, source) "
                f"VALUES ({release_id(config)}, {tag_id(tag['slug'])}, 'imported');"
            )

    for event in config.get("events", []):
        lines.append(
            """
INSERT OR IGNORE INTO events (
  slug, title, title_original, event_type, start_date, end_date, description, source_url, extra_json
) VALUES (
  {slug}, {title}, {title_original}, {event_type}, {start_date}, {end_date}, {description}, {source_url}, {extra_json}
);
""".format(
                slug=sql_quote(event["slug"]),
                title=sql_quote(event["title"]),
                title_original=sql_quote(event.get("titleOriginal")),
                event_type=sql_quote(event.get("eventType", "viprpg")),
                start_date=sql_quote(event.get("startDate")),
                end_date=sql_quote(event.get("endDate")),
                description=sql_quote(event.get("description")),
                source_url=sql_quote(event.get("sourceUrl")),
                extra_json=json_sql(event.get("extra", {})),
            ).strip()
        )
        release_event = event.get("releaseEvent")
        if release_event:
            lines.append(
                """
INSERT OR IGNORE INTO release_events (
  release_id, event_id, entry_label, entry_number, notes
) VALUES (
  {release_id}, {event_id}, {entry_label}, {entry_number}, {notes}
);
""".format(
                    release_id=release_id(config),
                    event_id=event_id(event["slug"]),
                    entry_label=sql_quote(release_event.get("entryLabel")),
                    entry_number=sql_quote(release_event.get("entryNumber")),
                    notes=sql_quote(release_event.get("notes")),
                ).strip()
            )

    for link in config.get("externalLinks", {}).get("work", []):
        lines.append(
            """
INSERT INTO work_external_links (work_id, label, url, link_type)
SELECT {work_id}, {label}, {url}, {link_type}
WHERE NOT EXISTS (
  SELECT 1 FROM work_external_links
  WHERE work_id = {work_id} AND url = {url}
);
""".format(
                work_id=work_id(config),
                label=sql_quote(link["label"]),
                url=sql_quote(link["url"]),
                link_type=sql_quote(link.get("linkType", "other")),
            ).strip()
        )
    for link in config.get("externalLinks", {}).get("release", []):
        lines.append(
            """
INSERT INTO release_external_links (release_id, label, url, link_type)
SELECT {release_id}, {label}, {url}, {link_type}
WHERE NOT EXISTS (
  SELECT 1 FROM release_external_links
  WHERE release_id = {release_id} AND url = {url}
);
""".format(
                release_id=release_id(config),
                label=sql_quote(link["label"]),
                url=sql_quote(link["url"]),
                link_type=sql_quote(link.get("linkType", "source")),
            ).strip()
        )

    lines.append(f"UPDATE archive_versions SET is_current = 0 WHERE release_id = {release_id(config)};")
    lines.append(
        """
INSERT OR IGNORE INTO archive_versions (
  release_id, archive_label, manifest_sha256, manifest_r2_key,
  file_policy_version, packer_version, source_type, source_name,
  source_file_count, source_size_bytes, excluded_file_count, excluded_size_bytes,
  total_files, total_size_bytes, unique_blob_size_bytes,
  core_pack_count, core_pack_size_bytes, estimated_r2_get_count,
  is_current, status, published_at
) VALUES (
  {release_id}, {archive_label}, {manifest_sha256}, {manifest_r2_key},
  {file_policy_version}, {packer_version}, {source_type}, {source_name},
  {source_file_count}, {source_size_bytes}, {excluded_file_count}, {excluded_size_bytes},
  {total_files}, {total_size_bytes}, {unique_blob_size_bytes},
  1, {core_pack_size_bytes}, {estimated_r2_get_count},
  0, 'published', CURRENT_TIMESTAMP
);
""".format(
            release_id=release_id(config),
            archive_label=sql_quote(archive["label"]),
            manifest_sha256=sql_quote(manifest_sha256),
            manifest_r2_key=sql_quote(manifest_r2_key),
            file_policy_version=sql_quote(config.get("filePolicyVersion", FILE_POLICY_VERSION)),
            packer_version=sql_quote(config["packerVersion"]),
            source_type=sql_quote(archive["sourceType"]),
            source_name=sql_quote(archive.get("sourceName")),
            source_file_count=stats["source_file_count"],
            source_size_bytes=stats["source_size_bytes"],
            excluded_file_count=stats["excluded_file_count"],
            excluded_size_bytes=stats["excluded_size_bytes"],
            total_files=len(entries),
            total_size_bytes=included_size,
            unique_blob_size_bytes=blob_unique_size,
            core_pack_size_bytes=core_pack_size,
            estimated_r2_get_count=estimated_r2_get_count,
        ).strip()
    )
    lines.append(
        f"UPDATE archive_versions SET is_current = 1, status = 'published' "
        f"WHERE id = {archive_version_id(config, manifest_sha256)};"
    )

    for sha256, entry in sorted(blobs.items()):
        lines.append(
            """
INSERT OR IGNORE INTO blobs (
  sha256, size_bytes, content_type_hint, observed_ext, r2_key,
  first_seen_archive_version_id, verified_at, status
) VALUES (
  {sha256}, {size_bytes}, {content_type_hint}, {observed_ext}, {r2_key},
  {archive_version_id}, CURRENT_TIMESTAMP, 'active'
);
""".format(
                sha256=sql_quote(sha256),
                size_bytes=entry.size_bytes,
                content_type_hint=sql_quote(entry.content_type_hint),
                observed_ext=sql_quote(entry.observed_ext),
                r2_key=sql_quote(blob_key(sha256)),
                archive_version_id=archive_version_id(config, manifest_sha256),
            ).strip()
        )

    lines.append(
        """
INSERT OR IGNORE INTO core_packs (
  sha256, size_bytes, uncompressed_size_bytes, file_count, r2_key,
  first_seen_archive_version_id, verified_at, status
) VALUES (
  {sha256}, {size_bytes}, {uncompressed_size_bytes}, {file_count}, {r2_key},
  {archive_version_id}, CURRENT_TIMESTAMP, 'active'
);
""".format(
            sha256=sql_quote(core_pack_sha256),
            size_bytes=core_pack_size,
            uncompressed_size_bytes=sum(entry.size_bytes for entry in core_entries),
            file_count=len(core_entries),
            r2_key=sql_quote(core_pack_key(core_pack_sha256)),
            archive_version_id=archive_version_id(config, manifest_sha256),
        ).strip()
    )

    for entry in sorted(entries, key=lambda item: item.rel_path.lower()):
        if entry.storage_kind == "blob":
            blob_sha = sql_quote(entry.sha256)
            core_id = "NULL"
            pack_entry = "NULL"
        else:
            blob_sha = "NULL"
            core_id = core_pack_id(core_pack_sha256)
            pack_entry = sql_quote(entry.pack_entry_path)
        lines.append(
            """
INSERT OR IGNORE INTO archive_version_files (
  archive_version_id, path, path_sort_key, path_bytes_b64, role,
  file_sha256, size_bytes, storage_kind, blob_sha256, core_pack_id,
  pack_entry_path, mtime_ms, file_mode
) VALUES (
  {archive_version_id}, {path}, {path_sort_key}, NULL, {role},
  {file_sha256}, {size_bytes}, {storage_kind}, {blob_sha256}, {core_pack_id},
  {pack_entry_path}, {mtime_ms}, NULL
);
""".format(
                archive_version_id=archive_version_id(config, manifest_sha256),
                path=sql_quote(entry.rel_path),
                path_sort_key=sql_quote(entry.rel_path.lower()),
                role=sql_quote(entry.role),
                file_sha256=sql_quote(entry.sha256),
                size_bytes=entry.size_bytes,
                storage_kind=sql_quote(entry.storage_kind),
                blob_sha256=blob_sha,
                core_pack_id=core_id,
                pack_entry_path=pack_entry,
                mtime_ms=entry.mtime_ms,
            ).strip()
        )

    lines.append(
        """
INSERT INTO import_jobs (
  work_id, release_id, archive_version_id, status, source_name, source_size_bytes,
  file_count, excluded_file_count, excluded_size_bytes, file_policy_version,
  missing_blob_count, missing_core_pack_count, created_at, updated_at, completed_at
)
SELECT
  {work_id}, {release_id}, {archive_version_id}, 'completed', {source_name}, {source_size_bytes},
  {file_count}, {excluded_file_count}, {excluded_size_bytes}, {file_policy_version},
  {missing_blob_count}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM import_jobs WHERE archive_version_id = {archive_version_id}
);
""".format(
            work_id=work_id(config),
            release_id=release_id(config),
            archive_version_id=archive_version_id(config, manifest_sha256),
            source_name=sql_quote(archive.get("sourceName")),
            source_size_bytes=stats["source_size_bytes"],
            file_count=len(entries),
            excluded_file_count=stats["excluded_file_count"],
            excluded_size_bytes=stats["excluded_size_bytes"],
            file_policy_version=sql_quote(config.get("filePolicyVersion", FILE_POLICY_VERSION)),
            missing_blob_count=len(blobs),
        ).strip()
    )

    for group in excluded:
        lines.append(
            """
INSERT OR IGNORE INTO import_job_excluded_file_types (
  import_job_id, file_type, file_count, total_size_bytes, example_path
) VALUES (
  {import_job_id}, {file_type}, {file_count}, {total_size_bytes}, {example_path}
);
""".format(
                import_job_id=import_job_id(config, manifest_sha256),
                file_type=sql_quote(group.file_type),
                file_count=group.file_count,
                total_size_bytes=group.total_size_bytes,
                example_path=sql_quote(group.example_path),
            ).strip()
        )

    media_by_path = {item["path"].replace("\\", "/"): item for item in config.get("mediaAssets", [])}
    entry_by_path = {entry.rel_path: entry for entry in entries}
    for media_path, media in media_by_path.items():
        entry = entry_by_path.get(media_path)
        if not entry or entry.storage_kind != "blob":
            continue
        lines.append(
            """
INSERT INTO media_assets (blob_sha256, kind, title, alt_text, width, height)
SELECT {blob_sha256}, {kind}, {title}, {alt_text}, NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM media_assets
  WHERE blob_sha256 = {blob_sha256}
    AND kind = {kind}
    AND IFNULL(title, '') = IFNULL({title}, '')
);
""".format(
                blob_sha256=sql_quote(entry.sha256),
                kind=sql_quote(media["kind"]),
                title=sql_quote(media.get("title")),
                alt_text=sql_quote(media.get("altText")),
            ).strip()
        )
        media_id = (
            "(SELECT id FROM media_assets "
            f"WHERE blob_sha256 = {sql_quote(entry.sha256)} "
            f"AND kind = {sql_quote(media['kind'])} "
            f"AND IFNULL(title, '') = IFNULL({sql_quote(media.get('title'))}, '') "
            "ORDER BY id LIMIT 1)"
        )
        lines.append(
            """
INSERT OR IGNORE INTO release_media_assets (
  release_id, media_asset_id, sort_order, is_primary
) VALUES (
  {release_id}, {media_id}, {sort_order}, {is_primary}
);
""".format(
                release_id=release_id(config),
                media_id=media_id,
                sort_order=sql_quote(media.get("sortOrder")),
                is_primary=sql_quote(bool(media.get("isPrimary"))),
            ).strip()
        )

    lines.append("")
    return "\n\n".join(lines)


def render_report(
    config: dict,
    entries: list[FileEntry],
    excluded: list[ExcludedGroup],
    manifest_sha256: str,
    core_pack_sha256: str,
    core_pack_size: int,
    stats: dict[str, int],
) -> str:
    core_entries = [entry for entry in entries if entry.storage_kind == "core_pack"]
    blob_entries = [entry for entry in entries if entry.storage_kind == "blob"]
    blob_unique = unique_blob_entries(entries)
    included_size = sum(entry.size_bytes for entry in entries)
    core_raw = sum(entry.size_bytes for entry in core_entries)
    blob_raw = sum(entry.size_bytes for entry in blob_entries)
    storage_total = sum(entry.size_bytes for entry in blob_unique.values()) + core_pack_size
    lines = [
        "# 本地样本游戏 Phase C 受控导入报告",
        "",
        f"Generated: {now_iso()}",
        "",
        "## 输入",
        "",
        f"- 源目录: `{config['sourcePath']}`",
        f"- Work: `{config['work']['slug']}` / {config['work']['primaryTitle']}",
        f"- Release: {config['release']['label']}",
        f"- ArchiveVersion: {config['archiveVersion']['label']}",
        f"- 文件策略: `{config.get('filePolicyVersion', FILE_POLICY_VERSION)}`",
        "",
        "## 拆解结果",
        "",
        f"- 源目录文件: {stats['source_file_count']} 个，{human_bytes(stats['source_size_bytes'])}",
        f"- 白名单内文件: {len(entries)} 个，{human_bytes(included_size)}",
        f"- 排除文件: {stats['excluded_file_count']} 个，{human_bytes(stats['excluded_size_bytes'])}",
        f"- Core pack 文件: {len(core_entries)} 个，原始 {human_bytes(core_raw)}，ZIP {human_bytes(core_pack_size)}",
        f"- Blob 文件引用: {len(blob_entries)} 个，原始 {human_bytes(blob_raw)}",
        f"- 唯一 blob: {len(blob_unique)} 个，{human_bytes(sum(entry.size_bytes for entry in blob_unique.values()))}",
        f"- 预计 canonical R2 新增体积: {human_bytes(storage_total)}，不含 manifest",
        f"- 预计单次下载 R2 Get: {1 + len(blob_unique)} 次（1 个 core pack + {len(blob_unique)} 个唯一 blob）",
        "",
        "## 内容地址",
        "",
        f"- Core pack SHA-256: `{core_pack_sha256}`",
        f"- Manifest SHA-256: `{manifest_sha256}`",
        f"- Core pack key: `{core_pack_key(core_pack_sha256)}`",
        f"- Manifest key: `{manifest_key(manifest_sha256)}`",
        "",
        "## 排除类型",
        "",
        "| 类型 | 文件数 | 大小 | 示例 |",
        "|---|---:|---:|---|",
    ]
    for group in excluded:
        lines.append(
            f"| `{group.file_type}` | {group.file_count} | "
            f"{human_bytes(group.total_size_bytes)} | `{group.example_path}` |"
        )
    if not excluded:
        lines.append("| (无) | 0 | 0 B |  |")

    lines.extend(
        [
            "",
            "## 当前策略观察",
            "",
            "- 本次没有上传完整游戏 ZIP，也没有把本地分卷 7z 写入 R2。",
            "- `StringScripts/` 与 `StringScripts_Origin/` 下的 `.txt` 文件按 v2 策略强制进入 core pack，不再作为独立 blob。",
            "- `screenshots/` 目录和根目录 `screenshot` / `screenshots` 文件按 v2 策略强制排除。",
            "- `Save*.lsd`、分卷包、`.r3proj` 和 `.bat` 被排除。",
            "",
            "## 最大白名单内文件 Top 20",
            "",
            "| 排名 | 大小 | 角色 | 存储 | 路径 |",
            "|---:|---:|---|---|---|",
        ]
    )
    for index, entry in enumerate(sorted(entries, key=lambda item: item.size_bytes, reverse=True)[:20], 1):
        lines.append(
            f"| {index} | {human_bytes(entry.size_bytes)} | {entry.role} | "
            f"{entry.storage_kind} | `{entry.rel_path}` |"
        )
    return "\n".join(lines) + "\n"


def command_prepare(args: argparse.Namespace) -> None:
    config = load_json(args.config)
    if args.source:
        config["sourcePath"] = str(args.source)
    source_root = Path(config["sourcePath"])
    if not source_root.exists():
        raise SystemExit(f"Source path does not exist: {source_root}")
    if config.get("filePolicyVersion", FILE_POLICY_VERSION) != FILE_POLICY_VERSION:
        raise SystemExit(f"Unsupported file policy: {config.get('filePolicyVersion')}")

    out_dir = run_dir(config["runId"])
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"scan_source={source_root}")
    entries, excluded, stats = scan_source(source_root, config)
    core_pack_path = out_dir / "core-main.zip"
    core_pack_sha256, core_pack_size = create_core_pack(entries, core_pack_path)
    manifest = build_manifest(config, entries, stats, core_pack_sha256, core_pack_size)
    manifest_json = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
    manifest_sha256 = sha256_bytes(manifest_json.encode("utf-8"))
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_bytes(manifest_json.encode("utf-8"))

    sql = build_sql(
        config,
        entries,
        excluded,
        manifest_sha256,
        manifest_key(manifest_sha256),
        core_pack_sha256,
        core_pack_size,
        stats,
    )
    sql_path = out_dir / "commit-staging.sql"
    sql_path.write_text(sql, encoding="utf-8")

    blob_plan = [
        {
            "sha256": sha256,
            "key": blob_key(sha256),
            "path": str(entry.abs_path),
            "relPath": entry.rel_path,
            "sizeBytes": entry.size_bytes,
            "contentType": entry.content_type_hint,
            "metadata": {
                "sha256": sha256,
                "sizeBytes": str(entry.size_bytes),
            },
        }
        for sha256, entry in sorted(unique_blob_entries(entries).items())
    ]
    upload_plan = {
        "runId": config["runId"],
        "environment": config["environment"],
        "bucketName": config["bucketName"],
        "d1Binding": config["d1Binding"],
        "manifestSha256": manifest_sha256,
        "manifestKey": manifest_key(manifest_sha256),
        "corePackSha256": core_pack_sha256,
        "corePackKey": core_pack_key(core_pack_sha256),
        "objects": [
            {
                "kind": "core_pack",
                "sha256": core_pack_sha256,
                "key": core_pack_key(core_pack_sha256),
                "path": str(core_pack_path),
                "sizeBytes": core_pack_size,
                "contentType": "application/zip",
                "metadata": {
                    "sha256": core_pack_sha256,
                    "sizeBytes": str(core_pack_size),
                    "fileCount": str(len([entry for entry in entries if entry.storage_kind == "core_pack"])),
                    "uncompressedSizeBytes": str(sum(entry.size_bytes for entry in entries if entry.storage_kind == "core_pack")),
                },
            },
            {
                "kind": "manifest",
                "sha256": manifest_sha256,
                "key": manifest_key(manifest_sha256),
                "path": str(manifest_path),
                "sizeBytes": manifest_path.stat().st_size,
                "contentType": "application/json; charset=utf-8",
                "metadata": {
                    "manifestSha256": manifest_sha256,
                },
            },
            *[
                {
                    "kind": "blob",
                    **item,
                }
                for item in blob_plan
            ],
        ],
        "summary": {
            **stats,
            "includedFileCount": len(entries),
            "includedSizeBytes": sum(entry.size_bytes for entry in entries),
            "coreFileCount": len([entry for entry in entries if entry.storage_kind == "core_pack"]),
            "coreRawSizeBytes": sum(entry.size_bytes for entry in entries if entry.storage_kind == "core_pack"),
            "corePackSizeBytes": core_pack_size,
            "blobReferenceCount": len([entry for entry in entries if entry.storage_kind == "blob"]),
            "uniqueBlobCount": len(blob_plan),
            "uniqueBlobSizeBytes": sum(item["sizeBytes"] for item in blob_plan),
            "estimatedR2GetCount": 1 + len(blob_plan),
        },
    }
    write_json(out_dir / "upload-plan.json", upload_plan)
    write_json(
        out_dir / "excluded-file-types.json",
        [group.__dict__ for group in excluded],
    )
    report = render_report(
        config,
        entries,
        excluded,
        manifest_sha256,
        core_pack_sha256,
        core_pack_size,
        stats,
    )
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    write_json(out_dir / "config.snapshot.json", config)

    print(f"out_dir={out_dir}")
    print(f"included_files={len(entries)} included_size={sum(entry.size_bytes for entry in entries)}")
    print(f"excluded_files={stats['excluded_file_count']} excluded_size={stats['excluded_size_bytes']}")
    print(f"unique_blobs={len(blob_plan)} core_pack_sha256={core_pack_sha256}")
    print(f"manifest_sha256={manifest_sha256}")


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def clean_proxy_env(env: dict[str, str]) -> dict[str, str]:
    result = dict(env)
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        result.pop(key, None)
    return result


def cloudflare_token_id(token: str) -> str:
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/user/tokens/verify",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("success"):
        raise RuntimeError("Cloudflare token verification failed")
    token_id = (payload.get("result") or {}).get("id")
    if not token_id:
        raise RuntimeError("Cloudflare token id is missing")
    return str(token_id)


def sign_v4_headers(
    *,
    method: str,
    account_id: str,
    bucket: str,
    key: str,
    access_key_id: str,
    secret_access_key: str,
    payload_sha256: str,
    content_type: str,
    metadata: dict[str, str],
) -> tuple[str, dict[str, str]]:
    timestamp = dt.datetime.now(dt.timezone.utc)
    amz_date = timestamp.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = timestamp.strftime("%Y%m%d")
    host = f"{account_id}.r2.cloudflarestorage.com"
    canonical_uri = "/" + urllib.parse.quote(f"{bucket}/{key}", safe="/~")
    headers = {
        "content-type": content_type,
        "host": host,
        "x-amz-content-sha256": payload_sha256,
        "x-amz-date": amz_date,
    }
    for meta_key, meta_value in metadata.items():
        header_name = "x-amz-meta-" + meta_key.lower().replace("_", "-")
        headers[header_name] = str(meta_value)
    canonical_headers = "".join(f"{name}:{headers[name].strip()}\n" for name in sorted(headers))
    signed_headers = ";".join(sorted(headers))
    canonical_request = "\n".join(
        [
            method,
            canonical_uri,
            "",
            canonical_headers,
            signed_headers,
            payload_sha256,
        ]
    )
    scope = f"{date_stamp}/auto/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signing_key = derive_signing_key(secret_access_key, date_stamp)
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    headers["authorization"] = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key_id}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    )
    url = f"https://{host}{canonical_uri}"
    return url, headers


def derive_signing_key(secret_access_key: str, date_stamp: str) -> bytes:
    key_date = hmac.new(("AWS4" + secret_access_key).encode("utf-8"), date_stamp.encode("utf-8"), hashlib.sha256).digest()
    key_region = hmac.new(key_date, b"auto", hashlib.sha256).digest()
    key_service = hmac.new(key_region, b"s3", hashlib.sha256).digest()
    return hmac.new(key_service, b"aws4_request", hashlib.sha256).digest()


def r2_credentials() -> tuple[str, str, str]:
    load_env_file(Path(".env.local"))
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not token or not account_id:
        raise SystemExit("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required")
    token_id = cloudflare_token_id(token)
    secret_access_key = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return account_id, token_id, secret_access_key


def put_r2_object(
    item: dict,
    *,
    account_id: str,
    access_key_id: str,
    secret_access_key: str,
    bucket: str,
    retries: int,
) -> None:
    path = Path(item["path"])
    data = path.read_bytes()
    payload_sha256 = item["sha256"] if item["kind"] != "manifest" else sha256_bytes(data)
    metadata = {str(k): str(v) for k, v in item.get("metadata", {}).items()}
    for attempt in range(1, retries + 1):
        url, headers = sign_v4_headers(
            method="PUT",
            account_id=account_id,
            bucket=bucket,
            key=item["key"],
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            payload_sha256=payload_sha256,
            content_type=item.get("contentType") or "application/octet-stream",
            metadata=metadata,
        )
        request = urllib.request.Request(url, data=data, headers=headers, method="PUT")
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                if response.status not in (200, 201):
                    raise RuntimeError(f"Unexpected R2 status: {response.status}")
            return
        except Exception:
            if attempt >= retries:
                raise
            time.sleep(min(2**attempt, 10))


def delete_r2_object(
    item: dict,
    *,
    account_id: str,
    access_key_id: str,
    secret_access_key: str,
    bucket: str,
    retries: int,
) -> None:
    payload_sha256 = hashlib.sha256(b"").hexdigest()
    for attempt in range(1, retries + 1):
        url, headers = sign_v4_headers(
            method="DELETE",
            account_id=account_id,
            bucket=bucket,
            key=item["key"],
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            payload_sha256=payload_sha256,
            content_type="application/octet-stream",
            metadata={},
        )
        request = urllib.request.Request(url, headers=headers, method="DELETE")
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                if response.status not in (200, 202, 204):
                    raise RuntimeError(f"Unexpected R2 status: {response.status}")
            return
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return
            if attempt >= retries:
                raise
            time.sleep(min(2**attempt, 10))
        except Exception:
            if attempt >= retries:
                raise
            time.sleep(min(2**attempt, 10))


def command_upload_r2(args: argparse.Namespace) -> None:
    plan_path = run_dir(args.run_id) / "upload-plan.json"
    plan = load_json(plan_path)
    objects = plan["objects"]
    if args.limit:
        objects = objects[: args.limit]
    bucket = args.bucket or plan["bucketName"]
    account_id, token_id, secret_access_key = r2_credentials()

    print(f"bucket={bucket}")
    print(f"objects={len(objects)} workers={args.workers}")
    uploaded = 0
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [
            executor.submit(
                put_r2_object,
                item,
                account_id=account_id,
                access_key_id=token_id,
                secret_access_key=secret_access_key,
                bucket=bucket,
                retries=args.retries,
            )
            for item in objects
        ]
        for future in concurrent.futures.as_completed(futures):
            future.result()
            uploaded += 1
            if uploaded == len(objects) or uploaded % args.progress_every == 0:
                elapsed = time.time() - started
                print(f"uploaded={uploaded}/{len(objects)} elapsed={elapsed:.1f}s")
    print("r2_upload=ok")


def command_delete_r2(args: argparse.Namespace) -> None:
    plan = load_json(run_dir(args.run_id) / "upload-plan.json")
    objects = plan["objects"]
    if args.limit:
        objects = objects[: args.limit]
    bucket = args.bucket or plan["bucketName"]
    account_id, token_id, secret_access_key = r2_credentials()

    print(f"bucket={bucket}")
    print(f"objects={len(objects)} workers={args.workers}")
    deleted = 0
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [
            executor.submit(
                delete_r2_object,
                item,
                account_id=account_id,
                access_key_id=token_id,
                secret_access_key=secret_access_key,
                bucket=bucket,
                retries=args.retries,
            )
            for item in objects
        ]
        for future in concurrent.futures.as_completed(futures):
            future.result()
            deleted += 1
            if deleted == len(objects) or deleted % args.progress_every == 0:
                elapsed = time.time() - started
                print(f"deleted={deleted}/{len(objects)} elapsed={elapsed:.1f}s")
    print("r2_delete=ok")


def run_wrangler(args: list[str]) -> subprocess.CompletedProcess[str]:
    load_env_file(Path(".env.local"))
    env = clean_proxy_env(os.environ)
    npx = "npx.cmd" if os.name == "nt" else "npx"
    command = [npx, "wrangler", *args]
    return subprocess.run(
        command,
        cwd=repo_root(),
        env=env,
        text=True,
        encoding="utf-8",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )


def command_apply_d1(args: argparse.Namespace) -> None:
    plan = load_json(run_dir(args.run_id) / "upload-plan.json")
    sql_path = run_dir(args.run_id) / "commit-staging.sql"
    result = run_wrangler(
        [
            "d1",
            "execute",
            plan["d1Binding"],
            "--env",
            plan["environment"],
            "--remote",
            "--file",
            str(sql_path),
            "--json",
        ]
    )
    print(result.stdout)
    if result.returncode != 0:
        raise SystemExit(result.returncode)
    print("d1_apply=ok")


def chunked(values: list[str], size: int) -> Iterable[list[str]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def sql_in_list(values: list[str]) -> str:
    if not values:
        return "NULL"
    return ", ".join(sql_quote(value) for value in values)


def build_reset_sql(config: dict, plan: dict) -> str:
    release_subquery = (
        "SELECT r.id FROM releases r "
        "JOIN works w ON w.id = r.work_id "
        f"WHERE w.slug = {sql_quote(config['work']['slug'])} "
        f"AND r.release_label = {sql_quote(config['release']['label'])}"
    )
    work_subquery = f"SELECT id FROM works WHERE slug = {sql_quote(config['work']['slug'])}"
    archive_subquery = f"SELECT id FROM archive_versions WHERE release_id IN ({release_subquery})"
    blob_hashes = sorted({item["sha256"] for item in plan["objects"] if item["kind"] == "blob"})
    core_pack_hashes = sorted({item["sha256"] for item in plan["objects"] if item["kind"] == "core_pack"})
    creator_slugs = sorted({item["slug"] for item in config.get("creators", [])})
    tag_slugs = sorted({item["slug"] for item in config.get("tags", [])})
    event_slugs = sorted({item["slug"] for item in config.get("events", [])})

    lines = [
        "PRAGMA foreign_keys = ON;",
        f"DELETE FROM import_job_excluded_file_types WHERE import_job_id IN (SELECT id FROM import_jobs WHERE archive_version_id IN ({archive_subquery}));",
        f"DELETE FROM import_jobs WHERE archive_version_id IN ({archive_subquery});",
        f"DELETE FROM release_media_assets WHERE release_id IN ({release_subquery});",
        f"DELETE FROM work_media_assets WHERE work_id IN ({work_subquery});",
    ]

    for chunk in chunked(blob_hashes, 100):
        lines.append(f"DELETE FROM media_assets WHERE blob_sha256 IN ({sql_in_list(chunk)});")

    lines.extend(
        [
            f"DELETE FROM archive_version_files WHERE archive_version_id IN ({archive_subquery});",
            f"UPDATE blobs SET first_seen_archive_version_id = NULL WHERE first_seen_archive_version_id IN ({archive_subquery});",
            f"UPDATE core_packs SET first_seen_archive_version_id = NULL WHERE first_seen_archive_version_id IN ({archive_subquery});",
            f"DELETE FROM archive_versions WHERE id IN ({archive_subquery});",
            f"DELETE FROM release_external_links WHERE release_id IN ({release_subquery});",
            f"DELETE FROM release_tags WHERE release_id IN ({release_subquery});",
            f"DELETE FROM release_staff WHERE release_id IN ({release_subquery});",
            f"DELETE FROM release_events WHERE release_id IN ({release_subquery});",
            f"DELETE FROM releases WHERE id IN ({release_subquery});",
            f"DELETE FROM work_external_links WHERE work_id IN ({work_subquery});",
            f"DELETE FROM work_tags WHERE work_id IN ({work_subquery});",
            f"DELETE FROM work_staff WHERE work_id IN ({work_subquery});",
            f"DELETE FROM work_titles WHERE work_id IN ({work_subquery});",
            f"DELETE FROM work_series WHERE work_id IN ({work_subquery});",
            f"DELETE FROM work_relations WHERE from_work_id IN ({work_subquery}) OR to_work_id IN ({work_subquery});",
            f"DELETE FROM works WHERE id IN ({work_subquery});",
        ]
    )

    for chunk in chunked(core_pack_hashes, 100):
        lines.append(f"DELETE FROM core_packs WHERE sha256 IN ({sql_in_list(chunk)});")
    for chunk in chunked(blob_hashes, 100):
        lines.append(f"DELETE FROM blobs WHERE sha256 IN ({sql_in_list(chunk)});")

    if creator_slugs:
        lines.append(
            "DELETE FROM creators "
            f"WHERE slug IN ({sql_in_list(creator_slugs)}) "
            "AND id NOT IN (SELECT creator_id FROM work_staff) "
            "AND id NOT IN (SELECT creator_id FROM release_staff);"
        )
    if tag_slugs:
        lines.append(
            "DELETE FROM tags "
            f"WHERE slug IN ({sql_in_list(tag_slugs)}) "
            "AND id NOT IN (SELECT tag_id FROM work_tags) "
            "AND id NOT IN (SELECT tag_id FROM release_tags);"
        )
    if event_slugs:
        lines.append(
            "DELETE FROM events "
            f"WHERE slug IN ({sql_in_list(event_slugs)}) "
            "AND id NOT IN (SELECT event_id FROM release_events);"
        )

    return "\n".join(lines) + "\n"


def command_reset_d1(args: argparse.Namespace) -> None:
    out_dir = run_dir(args.run_id)
    plan = load_json(out_dir / "upload-plan.json")
    config = load_json(out_dir / "config.snapshot.json")
    reset_sql = build_reset_sql(config, plan)
    reset_path = out_dir / "reset-staging.sql"
    reset_path.write_text(reset_sql, encoding="utf-8", newline="\n")
    result = run_wrangler(
        [
            "d1",
            "execute",
            plan["d1Binding"],
            "--env",
            plan["environment"],
            "--remote",
            "--file",
            str(reset_path),
            "--json",
        ]
    )
    print(result.stdout)
    if result.returncode != 0:
        raise SystemExit(result.returncode)
    print("d1_reset=ok")


def command_verify(args: argparse.Namespace) -> None:
    plan = load_json(run_dir(args.run_id) / "upload-plan.json")
    config = load_json(run_dir(args.run_id) / "config.snapshot.json")
    manifest_sha256 = plan["manifestSha256"]
    query = f"""
SELECT
  w.id AS work_id,
  r.id AS release_id,
  av.id AS archive_version_id,
  av.total_files,
  av.total_size_bytes,
  av.excluded_file_count,
  av.excluded_size_bytes,
  av.unique_blob_size_bytes,
  av.core_pack_size_bytes,
  av.estimated_r2_get_count,
  (SELECT COUNT(*) FROM archive_version_files WHERE archive_version_id = av.id) AS file_rows,
  (SELECT COUNT(*) FROM blobs) AS blob_table_count,
  (SELECT COUNT(*) FROM core_packs) AS core_pack_table_count
FROM archive_versions av
JOIN releases r ON r.id = av.release_id
JOIN works w ON w.id = r.work_id
WHERE w.slug = {sql_quote(config['work']['slug'])}
  AND r.release_label = {sql_quote(config['release']['label'])}
  AND av.manifest_sha256 = {sql_quote(manifest_sha256)};
"""
    query = " ".join(line.strip() for line in query.splitlines() if line.strip())
    result = run_wrangler(
        [
            "d1",
            "execute",
            plan["d1Binding"],
            "--env",
            plan["environment"],
            "--remote",
            "--command",
            query,
            "--json",
        ]
    )
    print(result.stdout)
    if result.returncode != 0:
        raise SystemExit(result.returncode)
    print("verify=ok")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    prepare = sub.add_parser("prepare", help="Scan source folder and generate core pack, manifest, SQL, and report.")
    prepare.add_argument("--config", type=Path, default=default_config())
    prepare.add_argument("--source", type=Path)
    prepare.set_defaults(func=command_prepare)

    upload = sub.add_parser("upload-r2", help="Upload generated canonical objects to R2 using the Cloudflare token.")
    upload.add_argument("--run-id", required=True)
    upload.add_argument("--bucket")
    upload.add_argument("--workers", type=int, default=8)
    upload.add_argument("--retries", type=int, default=3)
    upload.add_argument("--progress-every", type=int, default=100)
    upload.add_argument("--limit", type=int)
    upload.set_defaults(func=command_upload_r2)

    delete_r2 = sub.add_parser("delete-r2", help="Delete generated canonical objects from R2.")
    delete_r2.add_argument("--run-id", required=True)
    delete_r2.add_argument("--bucket")
    delete_r2.add_argument("--workers", type=int, default=8)
    delete_r2.add_argument("--retries", type=int, default=3)
    delete_r2.add_argument("--progress-every", type=int, default=100)
    delete_r2.add_argument("--limit", type=int)
    delete_r2.set_defaults(func=command_delete_r2)

    apply_d1 = sub.add_parser("apply-d1", help="Apply generated SQL to D1 with Wrangler.")
    apply_d1.add_argument("--run-id", required=True)
    apply_d1.set_defaults(func=command_apply_d1)

    reset_d1 = sub.add_parser("reset-d1", help="Delete this run's imported D1 records with the current upload plan.")
    reset_d1.add_argument("--run-id", required=True)
    reset_d1.set_defaults(func=command_reset_d1)

    verify = sub.add_parser("verify", help="Verify the imported archive version in D1.")
    verify.add_argument("--run-id", required=True)
    verify.set_defaults(func=command_verify)

    return parser


def main(argv: Iterable[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
