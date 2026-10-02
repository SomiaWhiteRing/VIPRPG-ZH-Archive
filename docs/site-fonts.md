# 网站字体策略与静态资源

网站通过 `app/root.tsx` 加载同源的
`/assets/fonts/site-fonts-5af26311f0c39afc.css`，使用原有的网页字体搭配：

- 正文：Inter 与 Noto Sans SC，使用 `app/shared.css` 的既有正文栈。
- 衬线标题：Noto Serif SC，在 `app/globals.css` 中配置。
- 等宽文字：IBM Plex Mono，使用 `app/shared.css` 的既有等宽栈。

字体文件使用原始 WOFF2 压缩分片和 `unicode-range`，浏览器按实际使用的
字体、字重和字符加载所需分片。保留原有字形、字重范围和字符覆盖，
不再进行额外的字体子集化。`font-display: swap` 允许字体到达前先显示
回退字体；首次加载仍可能发生字体切换，分片缓存后可复用。

`public/assets/fonts/` 保留哈希 URL、来源记录和许可证。Vite 将 `public/`
复制到 `build/client/`，由现有 Workers Static Assets 提供；不依赖外部字体
CDN、运行时代理或 R2。网站没有修改 `app/shared.css`，Android 离线页保持
现有字体栈，也不加载这些网站字体资源。

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
同步许可证和 manifest，不覆盖旧哈希 URL 的内容。
既有 `public/_headers` 对 `/assets/*` 提供一年 immutable 缓存。

## 验收

运行既有 UI 静态检查及相关文件的 ESLint。涉及静态打包时运行构建，确认
网站入口引用正确、字体 CSS 中的 WOFF2 引用全部存在，
`build/client/assets/fonts/` 与源文件一致，且构建后的 Wrangler 配置仍指向
客户端静态目录。
浏览器实际显示及国内网络表现需要另行验证；本地构建不代表已部署。
