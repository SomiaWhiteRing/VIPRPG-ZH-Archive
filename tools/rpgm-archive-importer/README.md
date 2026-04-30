# RPG Maker Archive Importer

受控导入工具，用来在浏览器导入页面完成前模拟“本地预索引 -> core pack -> manifest -> R2/D1 commit”的正式流程。

当前用途：

- 读取本地 RPG Maker 2000/2003 游戏文件夹。
- 按 `rpgm2000-2003-whitelist-v2` 强制白名单和路径覆盖规则过滤。
- 生成一个 ArchiveVersion 级 core pack。
- 生成规范化 manifest 和导入报告。
- 将 canonical 对象上传到 staging R2。
- 将作品、发布、归档快照和文件索引写入 staging D1。

它不会上传完整游戏 ZIP，也不会把原始完整包写入 R2。

## 当前样本

`samples/tokyo-butouhen-ova.staging.json` 对应本地目录：

```text
D:\path\to\game-folder
```

最近一次 staging 导入结果：

| 指标 | 结果 |
|---|---:|
| 源目录文件 | 3041 |
| 入库文件 | 3018 |
| 排除文件 | 23 |
| Core pack 文件 | 1272 |
| Core pack 大小 | 1.41 MB |
| 唯一 blob | 1705 |
| 唯一 blob 大小 | 119.97 MB |
| 预计下载 R2 Get | 1706 |

规则验证：

- `StringScripts/` 与 `StringScripts_Origin/` 下 862 个 `.txt` 进入 core pack。
- `screenshots/` 目录和根目录 `screenshot*` 文件不进入 manifest。
- R2 中 manifest、core pack、抽样 blob 的 SHA-256 与本地计划一致。

## 命令

典型命令：

```powershell
python tools\rpgm-archive-importer\rpgm_archive_import.py prepare --config tools\rpgm-archive-importer\samples\tokyo-butouhen-ova.staging.json
python tools\rpgm-archive-importer\rpgm_archive_import.py upload-r2 --run-id tokyo-butouhen-ova
python tools\rpgm-archive-importer\rpgm_archive_import.py apply-d1 --run-id tokyo-butouhen-ova
python tools\rpgm-archive-importer\rpgm_archive_import.py verify --run-id tokyo-butouhen-ova
```

需要清理本次试导入时：

```powershell
python tools\rpgm-archive-importer\rpgm_archive_import.py reset-d1 --run-id tokyo-butouhen-ova
python tools\rpgm-archive-importer\rpgm_archive_import.py delete-r2 --run-id tokyo-butouhen-ova
```

生成物默认放在 `tools/rpgm-archive-importer/workspace/`，该目录不进入版本控制。
