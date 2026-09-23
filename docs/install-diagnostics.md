# 临时安装性能诊断

诊断模块位于 `app/play/[archiveVersionId]/diagnostics/`，与正式安装器分离。普通入口不启动诊断定时器，不采集详细日志，不显示诊断面板，也不导入诊断 Worker。主安装器、OPFS 和数据库只保留可选观察点；未注册观察器时直接执行原操作。

## 启用和移除

在 `app/play/[archiveVersionId]/web-play-client.tsx` 替换唯一一行导入：

```ts
// 正常生产入口（默认）
import { createInstallWorker, InstallDiagnosticsPanel } from "./web-play-install-worker-entry";

// 需要诊断时，使用这一行替换上面一行，不要同时保留
import { createInstallWorker, InstallDiagnosticsPanel } from "./diagnostics/client";
```

之后按已有部署流程构建并部署对应环境。`diagnostics/worker.ts` 先注册观察器，再载入原安装器，执行相同的下载安装代码。网站更新后，APK 的主站页也需要重新加载页面才能使用新 Worker；不需要打开正式 APK 的 WebView 调试权限。此开关是构建时的源代码导入选择，不通过 URL 参数对访客开放。

结束排查时改回普通入口，重新构建部署并重新加载页面。无需删除诊断文件或逐个删除观察点。日志模块只对这次创建的安装 Worker 实例包装消息收发和终止操作，不修改浏览器全局原型，不影响其他 Worker。

## 在手机上取日志

1. 打开作品的在线游玩页面；诊断构建会在“本地数据与诊断”下方显示“详细安装诊断（临时）”。
2. 开始安装，停滞时保持页面在前台，留出数秒心跳记录。无需等到成功或报错才能导出。
3. 点击“导出 JSON”。若 Android 外壳不支持 Blob 下载，使用“复制日志”；剪贴板不可用时会展开只读文本框，可全选复制。
4. 取消前和取消后均可导出，比较 `page.worker-command` 与 `cancel.received` 以及未完成操作。

只在页面内存中保留记录，不自动上传、不持续写 OPFS/IndexedDB，避免增加被诊断的磁盘负担。刷新、关闭页面或进程退出会丢失日志；请先导出。SPA 导航期间模块仍在内存时可保留记录，但不保证浏览器回收后的恢复。导出是点击当时的快照；打开的文本框不会持续追加，需要收起后重新展开获得新快照。

## 记录内容

每条事件都有会话 ID、来源（page / worker）、序号、可跨线程对齐的 epoch 毫秒时间、相对时间、事件类型和结构化字段。每次安装有独立 Worker 会话 ID，重试有 attempt 编号；操作通过 start/end/error 中相同的 id 关联。

| 事件 | 内容 |
| --- | --- |
| `session.start` | UA、CPU 线程数、浏览器暴露的内存与网络估计、安装器版本、归档身份、存储后端、容量、安装/下载字节数 |
| `network.headers.*` | 请求到响应头耗时、HTTP 状态、Content-Length、编码、CF-Ray、缓存命中、ETag、Range 能力 |
| `network.read.*` | 每一次流读取的开始/结束/错误、字节数、累计量、读取前缓冲量、上一次读取结束至本次开始的间隔 |
| `network.resource-timing` | 浏览器可用时记录 DNS、连接、TLS、TTFB、响应耗时、实际协议、传输/编码/解码大小 |
| `zip.header.*` / `zip.entry` | 条目解析、真实文件路径、ZIP 数据偏移、压缩方式、CRC、大小、此前安装文件数 |
| `zip.skip.*` | 被跳过条目的路径、字节数、原因和读取耗时，区分下载后丢弃与真正写盘 |
| `zip.install-entry.*` | 每个安装条目的耗时、目标 pack 和偏移（包含内层读取/写入时间） |
| `buffer.coalesce` | 合并写入缓冲的字节数、chunk 数、CPU 耗时 |
| `opfs.*` | 目录/文件句柄、创建 writable、每次 write、close、重置半成品与索引写入的耗时和错误 |
| `idb.*` | 数据库 open、blocked、写事务、文件记录批次、安装状态保存耗时和错误 |
| `progress.*` | 进度持久化排队长度、排队等待时间、结束排队与最终等待队列排空 |
| `attempt.*` / `retry.wait.*` | 尝试序号、错误分类、是否允许重试、等待时长、是否从头下载 |
| `cancel.received` | Worker 收到取消请求的时刻（不代表取消已经完成） |
| `heartbeat` | 每秒的未完成操作及等待时长、最近条目、流读取速率、距上次收到字节的时间、进度队列与各类操作汇总 |
| `page.*` | 页面侧命令发出、Worker 错误/终止、正常日志、可见性和在线状态变化、独立主线程心跳 |
| `session.end` | 结束时状态和汇总；`outcome: finished` 表示 Worker 流程返回，实际成功与否看 installation.status |

响应头按白名单收集，URL 去掉 query 和 fragment；不记录 Cookie、Authorization、请求体、文件内容、存档或账号信息。导出包含游戏文件路径、版本、UA 和诊断错误信息，供排查使用。

## 如何定位停滞

- `network.read.start` 之后长时间没有同 id 的 end/error，而心跳仍持续：Worker 活着，正在等浏览器的读取 Promise；再结合最后收到字节时间、CF-Ray 和网络错误排查传输。
- `opfs.write.start` 没有结束：正在等待本地写入；这也会阻止下一次 `network.read` 发起。`consumerGapMs` 可以显示读流之外的时间。
- `idb.open` / `idb.transaction` 长时间未结束，或 `progress.queueDepth` 持续增加：进度存储可能落后于下载，尤其关注最后排空队列耗时。
- `zip.skip` 指向 exe 等条目且内部仅有 read：此时不是在写该文件，避免误判“安装文件数不变”为写盘卡住。
- Worker 心跳停止但 `page.heartbeat` 继续：检查 Worker 错误、CPU 长任务或调度停顿；页面心跳也停止时，结合 visibility 与 timerLagMs 判断后台节流或整体主线程停顿。该信号不能单独证明进程死锁。
- 页面已发出 cancel，但 Worker 没有 `cancel.received`：消息处理尚未响应；已收到 cancel 但 read 仍 pending：现有取消路径未中断正在等待的操作。

本模块只观察，不新增超时、不改变取消、重试或下载策略，因此仍能复现现有故障。

## 开销与完整性边界

逐次记录流读取不可避免有开销，诊断速度不能当作无日志模式的精确跑分。每 500 ms 批量发给页面，不逐事件写控制台，也不塞入原有最多 300 条的产品日志；UI 只显示简短计数，完整内容在导出时生成。

Worker 待发送缓冲最多 4,096 条，超出通过 `workerDroppedEvents` 计数。页面保留最早 128 条和最近记录，总量最多约 30,000 条或 6 Mi 字符（约 12 MiB UTF-16 文本，并非精确堆内存上限），旧批次淘汰数写入导出头；即使早期逐条事件淘汰，最近心跳仍保留累计操作汇总。真实 JS 对象、克隆及导出临时内存还会增加占用。

离开页面终止 Worker 时，尚未发出的最后约 500 ms 日志可能丢失；页面会记录 worker-terminated，缺少 session.end 的记录应视为未完成采集。浏览器冻结或页面主线程长期阻塞也可能延迟消息接收，内存限制不能约束浏览器内部消息队列。

`network.read` 是 JavaScript 消费流的速度，不等于网卡收包速率。嵌套操作耗时重叠，不能把 ZIP、read、write、IDB 汇总简单相加。Resource Timing 的空/零字段可能是不可用、缓存或连接复用，不应直接当成阶段耗时为零。网络估计 effectiveType 不是物理 Wi-Fi/移动网络类型。
