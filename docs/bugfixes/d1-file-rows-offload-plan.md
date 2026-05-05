# D1 文件行下放计划

## 1. 背景

当前 schema 把每个 ArchiveVersion 的每个文件展开成 `archive_version_files` 一行，包含 path、path_sort_key、file_sha256、crc32、size、role、storage_kind、blob_sha256/core_pack_id、pack_entry_path 等字段，并配 4 个索引。

同样的信息在 R2 的 manifest JSON 里已经完整存在一份——manifest 是 ArchiveVersion 的内容寻址快照，本身就是事实来源。

D1 当前的角色因此是 manifest 的二级展开索引，不是 canonical。

## 2. 问题

Cloudflare D1 单数据库硬上限 10 GB，且不可扩展。

按 `rpg-maker-2000-2003-deduplicated-storage-plan.md` §2.6 基线（419,521 文件 / 全量候选 177 个游戏）和当前 schema 估算：

- `archive_version_files` 单行表数据约 450 B，加 4 个索引共约 290 B/行，合计约 740 B/行。
- 当前规模：419k × 740 B ≈ 310 MB。
- 项目目标规模（按 5,000 个作品 × 平均 2 个 ArchiveVersion × 平均 2.4k 文件 ≈ 24M 行）：约 17.6 GB。

项目完成度约 60% 时会撞 10 GB 上限。撞了只能停服重构。越晚改迁移成本越高。

## 3. 关键观察

D1 实际需要支撑的查询只有两类：

1. 下载重组：按 `archive_version_id` 取全部文件清单。manifest JSON 已经包含全部信息，下载 worker 可直接读 R2 manifest，不需要 D1。
2. GC 反查引用：判断某个 blob / core_pack 是否还被任何 ArchiveVersion 引用。只需要 ArchiveVersion ↔ blob/core_pack 的多对多关系，不需要 path 等字段。

`archive_version_files` 大部分字段在 D1 里既不参与热路径查询，也不参与索引筛选——它们只是 manifest 的冗余镜像。

## 4. 方案

### 4.1 删除 `archive_version_files`，新增两张精简引用表

```sql
CREATE TABLE archive_version_blob_refs (
  archive_version_id INTEGER NOT NULL
    REFERENCES archive_versions(id) ON DELETE CASCADE,
  blob_sha256 TEXT NOT NULL
    REFERENCES blobs(sha256),
  PRIMARY KEY (archive_version_id, blob_sha256)
) WITHOUT ROWID;

CREATE INDEX idx_avbr_blob ON archive_version_blob_refs(blob_sha256);

CREATE TABLE archive_version_core_pack_refs (
  archive_version_id INTEGER NOT NULL
    REFERENCES archive_versions(id) ON DELETE CASCADE,
  core_pack_id INTEGER NOT NULL
    REFERENCES core_packs(id),
  PRIMARY KEY (archive_version_id, core_pack_id)
);

CREATE INDEX idx_avcpr_core_pack ON archive_version_core_pack_refs(core_pack_id);
```

每行约 80 B（含 PK 索引）。24M blob 引用 ≈ 1.9 GB；core_pack 引用远少。总占用降到原方案约 10%，永远不会撞 10 GB。

### 4.2 manifest 仍按现行格式存 R2

manifest JSON 已经记录每个文件的 path、file_sha256、crc32、size、role、storage_kind、blob_sha256/core_pack_id、pack_entry_path——保持不变即可，它接管原 `archive_version_files` 的所有非引用职责。

`archive_versions` 表保留 `manifest_sha256` 和 `manifest_r2_key`，不变。

### 4.3 改造点

| 模块 | 改动 |
|---|---|
| 新 migration | 创建两张引用表，迁移现有数据，最后 `DROP TABLE archive_version_files` |
| `lib/server/db/archive-commit.ts` | commit 时去重 blob/core_pack 集合，写两张引用表，不再分块写文件行 |
| `worker/archive-download.mjs` | `getDownloadRecord` 之后直接读 R2 manifest，按 manifest 构造 ZIP entries（`buildZipEntries` 改输入源） |
| `worker/archive-gc.mjs` | GC SQL 从 `NOT EXISTS (… archive_version_files …)` 改为 `NOT EXISTS (… archive_version_blob_refs …)` / `… core_pack_refs …` |
| `lib/server/db/archive-maintenance.ts` | 回收站清理逻辑同步改为删引用表 |
| 管理面板 | 若有按文件名/路径搜索功能，改为读 manifest（冷路径，可接受） |

### 4.4 取舍

得：

- D1 容量降一个数量级，目标规模内永不撞墙。
- commit 写入量大幅减少，不再受 D1 SQL 变量上限和 chunk 写入压力影响。
- manifest 成为唯一文件级事实来源，模型更清晰。
- D1 备份数据量同步降低，备份可行性更好。

失：

- 路径/CRC32 的临时查询需要读 manifest JSON（R2 GET），不能直接 SQL。属于冷路径，频次低。
- 下载 worker 多一次 R2 GET 读 manifest——但 manifest 通常 < 1 MB，可走 Workers Cache，且本来就要读它来重组 ZIP，影响极小。

### 4.5 时机

按 `AGENTS.md` 第 1 条"项目尚未正式上线，不为废弃模型保留兼容层"：

- 不写双写兼容层、不保留 `archive_version_files`、不做 legacy_ 包装。
- 一个 migration 直接迁移并 drop 旧表。
- 把决策同步到 `docs/game-domain-architecture.md` §4.4 和 `docs/rpg-maker-2000-2003-deduplicated-storage-plan.md` 的数据模型章节，删除原 `archive_version_files` schema，加入新两表，并说明文件级元数据下放到 manifest。

### 4.6 验收

- 全量样本（`rpg-maker-2000-2003-deduplicated-storage-plan.md` §2.7 的「本地样本游戏」）重导后，下载 ZIP 字节级一致。
- GC 在新表上能正确识别孤儿 blob / core_pack。
- D1 `pragma_page_count * pragma_page_size` 在导入相同样本后比旧 schema 小一个数量级。
- 现有 e2e（`npm run smoke:staging`）通过。

## 5. 2026-05-05 批判性修正和最终落地方案

本问题判断成立，但原方案过于简化。`archive_version_files` 确实会让 D1 被文件级索引长期拖垮；不过当前项目里它还承担 Web Play 安装体积统计、GC、回收站最终清理和一致性检查等职责，不能只把下载和 GC 两条路径改掉。

最终采用以下修正：

- R2 manifest 成为唯一文件级事实来源，继续保存 path、pathSortKey、role、sha256、crc32、size、storage 和 core pack entry。manifest type 预留 `pathBytesB64`，后续若需要原始 ZIP 文件名字节恢复，字段进入 manifest 而不是 D1。
- D1 删除 `archive_version_files`，新增 `archive_version_blob_refs` 和 `archive_version_core_pack_refs`。这两张表只表达 ArchiveVersion 到物理对象的保活引用，不保存路径和 CRC32。
- `archive_versions` 新增 `web_play_file_count` 和 `web_play_size_bytes`。上传 commit 时从 manifest 按 Web Play 本地写入规则派生，避免 `/web-play` 元数据接口每次读取 R2 manifest。
- GC 保活规则补齐媒体引用：`works.icon_blob_sha256`、`works.thumbnail_blob_sha256`、`media_assets.blob_sha256` 都会阻止 blob 被当作孤儿对象清理。
- 回收站最终清理只删除 manifest R2 对象和引用表记录；blob / core pack 仍由后续 GC sweep 根据全局引用关系清理。
- 已保留迁移历史，不重写已应用数据库。`0006_offload_archive_file_rows.sql` 负责创建引用表、从旧 `archive_version_files` 回填、补齐 Web Play 派生统计并 drop 旧表。

本次改造的关键结论是：D1 负责关系、状态和对象保活；manifest 负责文件级快照。不要再把完整文件清单镜像回 D1，也不要让 GC 只看归档文件引用而忽略资料库媒体引用。

## 6. 2026-05-05 验证和部署记录

- 本地 `npm run check` 通过：TypeScript 和 ESLint 均无错误。
- 本地空 D1 顺序应用 `0001` 到 `0006` 通过；最终 schema 只保留 `archive_version_blob_refs` 和 `archive_version_core_pack_refs`，没有 `archive_version_files`。
- staging 远端已应用 `0006_offload_archive_file_rows.sql`。迁移后 staging D1 中旧表不存在，引用表存在。
- staging 回填结果：`archive_version_blob_refs = 3686`，`archive_version_core_pack_refs = 2`；当前 published ArchiveVersion `#8` 和 `#13` 均有 Web Play 安装统计。
- 引用完整性检查：staging 中 `missing_blob_refs = 0`、`missing_core_pack_refs = 0`。
- 媒体 blob 保活检查：staging 当前存在 6 个资料库媒体 blob 引用，GC 逻辑已把这些引用纳入保活条件。
- staging 部署通过，版本 ID：`7d57397d-43d5-44b8-95f0-afd33b5b7913`。
- `npm run smoke:staging` 通过：首页、资料库、作者、角色、标签、系列和 health API 均返回 200。
- `GET /api/archive-versions/13/web-play` 返回 `installTotalFiles = 5533`、`installTotalSizeBytes = 112299396`，说明 Web Play 元数据已改用 D1 派生统计。
- `HEAD /api/archive-versions/13/download` 返回 200、`Content-Length = 130098240`、`X-Download-Zip-Builder = zip-store-v7-local-crc-no-descriptor`，下载端仍可从 manifest 构建固定长度 ZIP。
