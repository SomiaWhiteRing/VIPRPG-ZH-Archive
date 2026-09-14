# 论坛开发与数据维护

页面行为、数据不变量与权限边界见[论坛设计](./forum-discussion-design.md)。论坛使用 Next App Router、共享根布局和 Route Handler；数据服务负责全文索引、批量读取、连续编号与维护统计。

## 开发与检查

主站和论坛日常开发使用 `npm run dev`，通过 OpenNext 开发配置访问本地 D1/R2。`npm run preview` 验证打包后的 Worker、binding 与原生下载链路。构建和部署沿用 `scripts/open-next.mjs`。

现有论坛持久契约入口是 `npm run test:forum`，覆盖编号、幂等、失败回滚、版本冲突、搜索同步和权限边界。检查选择与执行顺序遵循[维护手册](./maintenance-regression.md)。

性能调整以保留页面体验和权限正确性为前提。测量时区分数据库等待、请求总耗时与 Worker CPU，不将单项指标作为替换框架或删减功能的依据。

## 备份与数据转换

新空库顺序安装 migration。已有 0001–0004 论坛库先停止写入、备份整个 D1，再执行离线转换；不要先单独安装 0005，以免留下未填充的全文索引。

```powershell
npm run forum:offline -- --input backup.sql --output output/forum-conversion --convert
```

输入可以是完整 SQL 导出或 SQLite 快照，输出目录必须不存在。输出包含 `before.sqlite`、`converted.sqlite`、`conversion.sql` 和 `verification.json`。转换检查外键、连续楼号与正文限额，分配楼内编号，初始化统计、搜索映射和全文索引；索引的 `scope` 只保存当前公开性。

转换保留源 ID、正文、互动和图片引用，移除被替代的 `title_search`、`body_search` 派生字段，并核对源记录、楼内编号、回复计数、搜索映射和索引内容。任一不一致会停止转换。

停止本地开发服务后，可对实际 `.sqlite` 使用新输出目录和 `--apply`；工具先通过 SQLite 在线备份接口保存包含已提交 WAL 的快照。远端只应用已在最新备份副本上验证通过的 `conversion.sql`，不能把 SQL 导出作为 `--apply` 输入。

转换与服务切换期间禁止业务写入。失败时使用已留存的整库备份和对应 Worker 版本恢复，不能只回退代码而保留不兼容 schema。工具拒绝再次转换已有统一搜索映射的库。

演示数据使用 `npm run db:local:seed:update` 增量补齐，不用 reset 覆盖手工修改，详见[本地展示数据](./local-demo-data.md)。

## 离线导出

```powershell
npm run forum:offline -- --input backup.sqlite --output output/forum-export --export
```

输出源论坛表的 JSONL 和数量清单，不包含可重建的 FTS 内部表。图片元数据包含 R2 对象键与指纹，图片字节需另行备份。图片清理由有权限的管理人员按现行规则执行。
