# 论坛开发与数据维护

页面行为、数据不变量与权限边界见[论坛设计](./forum-discussion-design.md)。论坛使用 React Router SSR、共享根布局和 Hono API；数据服务负责全文索引、批量读取、连续编号与维护统计。

## 开发与检查

主站和论坛日常开发使用 `npm run dev`，通过 Cloudflare Vite 插件访问本地 D1/R2。`npm run preview` 验证打包后的 Worker、binding 与原生下载链路。构建和部署统一使用 `scripts/app.mjs`。

现有论坛持久契约入口是 `npm run test:forum`，覆盖编号、幂等、失败回滚、版本冲突、搜索同步和权限边界。检查选择与执行顺序遵循[维护手册](./maintenance-regression.md)。

性能调整以保留页面体验和权限正确性为前提。测量时区分数据库等待、请求总耗时与 Worker CPU，不将单项指标作为替换框架或删减功能的依据。

## 初始化与备份

空库由 `migrations/0001_init_archive_schema.sql` 一次创建当前论坛结构、图片位置、楼内编号、统计字段和 FTS 索引。旧论坛模型的离线转换已移除。旧开发库按[本地展示数据](./local-demo-data.md) 的备份与重建流程处理；Wrangler 不会重新应用已经登记的同名初始化文件。

本地初始化使用 `npm run db:local:seed` 恢复固定快照；已有数据时拒绝覆盖。人工编辑后的数据可用 `npm run db:local:seed:capture` 固化为新版种子，详见[本地展示数据](./local-demo-data.md)。

## 离线导出

```powershell
npm run forum:offline -- --input backup.sqlite --output output/forum-export --export
```

输入可以是完整 SQL 导出或 SQLite 快照，输出目录必须不存在。工具只读源库；SQL 导出在内存中加载。输出源论坛表的 JSONL 和数量清单，不包含可重建的 FTS 内部表。图片元数据包含 R2 对象键与指纹，图片字节需另行备份。图片清理由有权限的管理人员按现行规则执行。
