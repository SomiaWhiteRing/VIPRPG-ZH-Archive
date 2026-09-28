# 账户偏好

设置入口为 `/me/privacy`（隐私与偏好）。隐私和偏好分表单保存，沿用同源校验与当前账户鉴权。

## 存储与读取负载

`0007_account_preferences.sql` 为 `users` 增加默认开启的 `include_player_in_zip` 和可空 JSON 数组 `account_shortcuts`。NULL 使用代码共享默认值；空数组表示不显示任何可配置入口。数组最多为当前可选入口数量，提交时校验白名单、重复项及 512 字符上限，按数组顺序输出，不运行 SQL 排序。

两个字段随已有 `USER_ACCESS_COLUMNS` 查询读取，请求内继续复用 `memoizeRequest`，根 loader 将偏好随 session 返回。头像菜单和下载按钮不请求独立偏好 API，不逐项查库。写入按 `users` 整数主键定位；不存在按偏好筛选用户的业务，所以不增加表、关联、二级索引或定时缓存刷新。路由原有的根 loader 重验证策略不变，不为节省偏好读取而延迟权限、会话撤销或提醒更新。

保存后跳转重新读取当前值；其他设备下一次服务器加载时获取最新值，不主动推送到闲置标签页。注销账户同时清空偏好。

## 快捷入口

`lib/account-preferences.ts` 从个人中心导航派生可选项，排除概览与权限申请，并共享默认顺序：收藏、表情库、我的目录。头像菜单的个人中心入口固定保留。我的上传仅在具有相应权限时显示，保存的选择不会因临时失去权限而丢失。编辑器使用已有 React Aria GridList、Checkbox 和拖放组件，支持多选及键盘排序。

## 下载

附带播放器默认开启。关闭时按钮使用 `buildWebPlayDownloadUrl()`，与在线游玩完全共用 `web-play-v2` 的 URL、缓存键、ETag 和 ZIP 字节。下载 Worker 不读用户偏好或 Cookie，不产生每用户缓存变体。新 profile 只排除根目录 `Player.exe`（不区分大小写），不注入共享播放器。已发布的 `web-play-v1` 保留原过滤语义，支持已有客户端与续传。

本地安装仍按原规则跳过普通 EXE/DLL/TXT，因此不修改已有安装键、存档、安装体积统计或已安装资源。下载体积沿用归档有效载荷口径，不包含 ZIP 头。旧归档可能仍在 manifest 中保存根 Player.exe；`0007_account_preferences.sql` 增加 `embedded_player_size_bytes` 投影，新入库时计算，历史值从不可变 manifest 一次性回填。关闭附带播放器时，卡片、列表、下载按钮和文件信息统一从归档体积减去该值，不使用过滤更多文件的本地安装体积，也不在浏览页面时读取 R2 manifest。

部署代码前需应用 0007 合并迁移，并完成历史 manifest 投影回填。`node scripts/archive-player-size-backfill.mjs output.sql manifest.json [...]` 只生成 SQL，按内容 SHA-256 和总容量定位，不修改归档文件。远端导出与回填需按具体目标和批次另行授权。固定开发种子已同步结构与迁移账本，本地数据库已迁移与回填；未执行远端迁移或部署。
