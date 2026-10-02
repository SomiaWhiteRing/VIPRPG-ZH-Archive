# 网站字体策略与静态资源

网站在 `app/globals.css` 中使用设备自带的正文、衬线标题和等宽字体，
`app/root.tsx` 不再加载字体 CSS，页面不会发起网页字体下载。字形随设备
已安装的字体而变化。网站覆写不修改 `app/shared.css`，Android 离线页保持
现有字体栈，也不加载这些网站字体资源。

已有 `public/assets/fonts/` 保留其哈希 URL 和来源记录，供已经缓存的旧页面
继续使用。Vite 将 `public/` 复制到 `build/client/`，由现有 Workers Static
Assets 提供；不依赖外部字体 CDN、运行时代理或 R2。

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
CSS 文件名同样添加内容 SHA-256 前 16 位。重新引入字体时，先评估实际页面
需要的字体分片及首屏传输量，再更新入口引用。
同步许可证和 manifest，清理不再引用的旧文件，不覆盖旧哈希 URL 的内容。
既有 `public/_headers` 对 `/assets/*` 提供一年 immutable 缓存。

## 验收

运行既有 UI 静态检查及相关文件的 ESLint。涉及静态打包时运行构建，确认
网站入口没有字体 CSS 引用、网站字体栈只使用安装字体，且构建后的
Wrangler 配置仍指向客户端静态目录。
浏览器实际显示及国内网络表现需要另行验证；本地构建不代表已部署。
