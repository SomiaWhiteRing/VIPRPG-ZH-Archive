# 网站字体静态资源

网站通过 `app/root.tsx` 加载 `public/assets/fonts/` 中的字体 CSS。Vite 将
`public/` 复制到 `build/client/`，由现有 Workers Static Assets 提供；不依赖
外部字体 CDN、运行时代理或 R2。Android 离线入口不加载这些网站字体资源。

保留 Inter、Noto Sans SC、Noto Serif SC 和 IBM Plex Mono，以及现有系统回退。
前三者使用可变字重 WOFF2，IBM Plex Mono 保留 400/500/600/700 常规字重。
所有字体保留上游 `unicode-range` 分片及 `font-display: swap`，不会在首页
预加载整个字体库。共 229 个 WOFF2 文件，10,966,136 字节，CSS 214,155 字节。

## 来源与更新

`public/assets/fonts/manifest.json` 记录 npm 包的固定版本、tarball URL、SHA-512
integrity，以及每个字体文件的来源、大小与 SHA-256。各字体原始 LICENSE
随资源分发。导入来源为 Fontsource 5.3.0：

- `@fontsource-variable/inter`
- `@fontsource-variable/noto-sans-sc`
- `@fontsource-variable/noto-serif-sc`
- `@fontsource/ibm-plex-mono`

更新时下载指定版本的 npm tarball 并核验 integrity。前三个包使用 `index.css`，
IBM Plex Mono 使用 `400.css`、`500.css`、`600.css`、`700.css`；仅复制这些
CSS 实际引用的 WOFF2，去掉旧 WOFF 备选源。将 CSS 字体族名末尾的
` Variable` 去掉，以维持网站既有字体族名称；字体二进制不修改。

WOFF2 文件名添加其 SHA-256 的前 16 位，CSS 引用同目录的这些文件。合并后的
CSS 文件名同样添加内容 SHA-256 前 16 位，并更新 `app/root.tsx` 的引用。
同步许可证和 manifest，清理不再引用的旧文件，不覆盖旧哈希 URL 的内容。
既有 `public/_headers` 对 `/assets/*` 提供一年 immutable 缓存。

## 验收

运行既有 UI 静态检查及 root.tsx 的 ESLint。涉及静态打包时运行构建，确认
`build/client/assets/fonts/` 与源文件一致、CSS 引用全部存在，且构建后的
Wrangler 配置指向客户端静态目录，没有让字体请求优先进入 Worker。
浏览器实际显示及国内网络表现需要另行验证；本地构建不代表已部署。
