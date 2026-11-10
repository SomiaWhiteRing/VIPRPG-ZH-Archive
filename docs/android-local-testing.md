# Android 模拟器本地测试

需要在 Android App 中验证尚未部署的网站改动时，可以让独立调试包通过 ADB 访问本机网站。网站仍在本机运行，模拟器访问 `https://localhost`，无需公网隧道、推送代码或部署预生产。以下步骤是 Windows、MuMu、Android SDK 和 Gradle 的实测方法；本地构建和模拟器交互按当前任务已获授权的范围执行。

这个方法使用独立的本地 D1/R2 状态和演示账号，不访问正式数据。调试包使用独立包名 `org.viprpg.archive.localdebug`，不覆盖正式 App，也不共享它的游戏、存档或登录态。APK 绑定本次生成的证书：更换证书后需要重建 APK。停止服务或移除 ADB 转发后，该包无法再连接本地网站。

## 准备隔离目录和数据

在仓库根目录的 PowerShell 中执行。需要 Node.js、项目依赖、已配置本地绑定的 `wrangler.jsonc`、Android SDK、Gradle 8.13、JDK 17 或以上、ADB 和 OpenSSL。示例使用 Git for Windows 自带的 OpenSSL；按实际安装位置修改路径。端口 `3015` 和转发用的模拟器端口 `443` 必须空闲；需要 DevTools 时，本机端口 `9335` 也须空闲。

```powershell
$repo = (Get-Location).Path
$testDir = Join-Path $repo ("output/android-local-" + (Get-Date -Format yyyyMMdd-HHmmss))
$env:VIPRPG_LOCAL_DEBUG_DIR = $testDir
New-Item -ItemType Directory -Path $testDir, "$testDir/res/raw", "$testDir/res/xml" | Out-Null

& 'C:/Program Files/Git/usr/bin/openssl.exe' req -x509 -newkey rsa:2048 -nodes `
  -keyout "$testDir/localhost-key.pem" -out "$testDir/localhost-cert.pem" `
  -days 7 -subj '/CN=localhost' `
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' `
  -addext 'basicConstraints=critical,CA:TRUE'
if ($LASTEXITCODE -ne 0) { throw '证书生成失败' }
Copy-Item -LiteralPath "$testDir/localhost-cert.pem" -Destination "$testDir/res/raw/local_debug_ca.pem"
```

证书私钥只供本机临时服务使用，不提交仓库。以下临时配置从本机 `wrangler.jsonc` 保留绑定标识，使其与固定种子使用同一本地状态；关闭远程绑定、定时任务、邮件绑定和统计，并生成独立的本地认证密钥。`envDir` 指向隔离目录，不读取仓库根目录的 `.env.local`。

```powershell
@'
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { parse } from "jsonc-parser";

const root = process.cwd();
const task = process.env.VIPRPG_LOCAL_DEBUG_DIR;
const config = parse(readFileSync("wrangler.jsonc", "utf8"));
delete config.env;
delete config.routes;
config.name = "viprpg-android-local-debug";
config.main = resolve(root, "worker.ts");
config.workers_dev = false;
config.triggers = { crons: [] };
config.vars = {
  APP_ORIGIN: "http://127.0.0.1:3015", EMAIL_FROM: "noreply@viprpg.org",
  SITE_NOINDEX: "true", GA_ENABLED: "false", AUTH_SECRET: randomBytes(32).toString("hex"),
};
config.d1_databases.forEach(binding => { binding.remote = false; binding.migrations_dir = resolve(root, "migrations"); });
config.r2_buckets.forEach(binding => { binding.remote = false; });
config.send_email = [];
writeFileSync(resolve(task, "wrangler.jsonc"), JSON.stringify(config, null, 2));

let vite = readFileSync("vite.config.ts", "utf8")
  .replace('"./scripts/style-namespace.mjs"', '"../../scripts/style-namespace.mjs"')
  .replace('fileURLToPath(new URL(".", import.meta.url))', JSON.stringify(root))
  .replace("cloudflare({", `cloudflare({ configPath: ${JSON.stringify(resolve(task, "wrangler.jsonc"))}, persistState: { path: ${JSON.stringify(resolve(task, "state"))} }, remoteBindings: false, inspectorPort: false,`)
  .replace("defineConfig({", `defineConfig({ root: ${JSON.stringify(root)}, envDir: ${JSON.stringify(task)},`)
  .replace("port: 3000", "port: 3015")
  .replace("strictPort: false", "strictPort: true")
  .replace("server: {", `server: { https: { key: readFileSync(${JSON.stringify(resolve(task, "localhost-key.pem"))}), cert: readFileSync(${JSON.stringify(resolve(task, "localhost-cert.pem"))}) }, hmr: { host: "localhost", clientPort: 443, protocol: "wss" },`);
writeFileSync(resolve(task, "vite.config.ts"), 'import { readFileSync } from "node:fs";\n' + vite);
'@ | Set-Content -LiteralPath "$testDir/prepare.mjs" -Encoding utf8
node "$testDir/prepare.mjs"
node scripts/dev-seed.mjs --persist-to "$testDir/state"
```

固定种子只应恢复到新建的空状态目录；不要重置或覆盖现有开发库。恢复包含 R2 演示资源，可能需要数分钟。种子脚本正常结束后才启动网站；如果脚本中断，即使已经打印部分成功信息，也应核实状态和迁移账本，不能直接当作完整恢复。演示账号及密码见[本地展示数据](local-demo-data.md#账号)。

## 构建本机调试包

调试版只为 `localhost` 信任刚生成的证书，不改正式包的网络策略。在同一个 PowerShell 中生成临时资源和 Gradle 初始化文件：

```powershell
@'
<network-security-config>
  <domain-config cleartextTrafficPermitted="false">
    <domain>localhost</domain>
    <trust-anchors><certificates src="@raw/local_debug_ca" /></trust-anchors>
  </domain-config>
</network-security-config>
'@ | Set-Content -LiteralPath "$testDir/res/xml/local_debug_network.xml" -Encoding utf8

@'
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:networkSecurityConfig="@xml/local_debug_network" />
</manifest>
'@ | Set-Content -LiteralPath "$testDir/AndroidManifest.xml" -Encoding utf8

@'
gradle.beforeProject { project ->
  project.plugins.withId('com.android.application') {
    project.androidComponents.finalizeDsl { android ->
      def task = new File(System.getenv('VIPRPG_LOCAL_DEBUG_DIR'))
      android.defaultConfig.applicationId = 'org.viprpg.archive.localdebug'
      android.sourceSets.debug.res.srcDir new File(task, 'res')
      android.sourceSets.debug.manifest.srcFile new File(task, 'AndroidManifest.xml')
    }
  }
}
'@ | Set-Content -LiteralPath "$testDir/debug.init.gradle" -Encoding utf8
```

设置 `ANDROID_HOME` 为本机 SDK 路径，把 `$gradle` 指向 Gradle 8.13 的 `bin/gradle.bat`，然后构建。`android:web:build` 会更新被忽略的 Android 构建资源；如需保留已有产物，先另行保存。当前项目没有 `android/app/src/debug/AndroidManifest.xml`；如果以后新增，应合并其内容，不要用临时 manifest 遮掉已有配置。

```powershell
$env:ANDROID_HOME = '<Android SDK 的绝对路径>'
$gradle = '<Gradle 8.13 的绝对路径>/bin/gradle.bat'
npm run android:web:build
if ($LASTEXITCODE -ne 0) { throw 'Android 网页资源构建失败' }
Push-Location android
try {
  & $gradle --no-daemon --console=plain '-Dcom.android.build.gradle.overridePathCheck=true' `
    '-Pandroid.overridePathCheck=true' -I "$testDir/debug.init.gradle" `
    :app:assembleDebug '-PsiteOrigin=https://localhost'
  if ($LASTEXITCODE -ne 0) { throw '调试包构建失败' }
} finally { Pop-Location }
Copy-Item -LiteralPath 'android/app/build/outputs/apk/debug/app-debug.apk' -Destination "$testDir/local-debug.apk"
```

`https://localhost` 不带端口：当前 App 的同源判断和离线资源加载要求 HTTPS 默认端口。证书和 manifest 均只在这份调试包内使用，不能用于发布。

## 启动和验证

先通过 `adb devices` 确认目标序列号，以下 `$device` 仅是示例。模拟器的 `443` 转发到主机的 `3015`；部分模拟器需要 root 才能绑定低端口。`adb root` 会重启该模拟器的 ADB 服务并断开它的其他 ADB 会话，先确认没有其他任务依赖该连接。

```powershell
$device = '127.0.0.1:16384'
adb -s $device reverse --list
adb -s $device reverse --no-rebind tcp:443 tcp:3015
```

如果报 `cannot bind listener: Permission denied`，且已确认不影响其他任务，才执行：

```powershell
adb -s $device root
adb -s $device wait-for-device
adb -s $device reverse --no-rebind tcp:443 tcp:3015
```

如果 `443` 已有转发，`--no-rebind` 会拒绝覆盖，应先确认该连接的归属；如果模拟器不支持 `adb root`，使用允许该转发的独立模拟器。

在另一个以仓库为当前目录的终端设置步骤一生成的隔离目录，运行网站并保持该终端运行：

```powershell
$testDir = '<步骤一生成的隔离目录绝对路径>'
node scripts/build-android-player.mjs
if ($LASTEXITCODE -ne 0) { throw '本地 Player 资源准备失败' }
node node_modules/@react-router/dev/bin.cjs dev . --config "$testDir/vite.config.ts"
```

本地 Player 生成到已忽略的 `public/play/runtime/android/v1/`。首次进入本地游戏库前，确认调试包可访问同源清单。更换本地运行包后重跑资源生成命令。

服务就绪后，在原终端安装并打开调试包：

```powershell
adb -s $device install -r "$testDir/local-debug.apk"
adb -s $device shell am start -n org.viprpg.archive.localdebug/org.viprpg.archive.MainActivity
```

`dev . --config` 中的 `.` 指明仓库根目录；缺少它时 React Router 会把临时配置目录误认为项目根目录。服务只监听本机 `127.0.0.1:3015`。浏览器对照可使用 `https://localhost:3015` 和同一演示账号；该临时自签名证书会触发浏览器证书提示。热更新连接针对模拟器的 `443` 配置，桌面浏览器如未自动更新可手动刷新。将网页视口宽高设为与 WebView 的 CSS 视口一致，再比较同一页面；模拟器的系统状态栏和 App 底栏不属于网页视口。

首次加载时 Vite 可能重新优化依赖并刷新页面。若只出现静态页面、按钮没有反应，应查看开发服务及 WebView 的脚本错误，等待优化结束并重新加载，不能仅凭 HTTP 200 判定交互正常。需要检查页面时，可将当前调试 WebView 的 DevTools socket 转发到本机：

```powershell
$appPid = (adb -s $device shell pidof org.viprpg.archive.localdebug).Trim()
adb -s $device forward --list
adb -s $device forward --no-rebind tcp:9335 "localabstract:webview_devtools_remote_$appPid"
Invoke-RestMethod 'http://127.0.0.1:9335/json'
```

使用返回的本机 DevTools 地址检查实际页面、控制台和元素；只转发目标 App 的调试 socket。可用 `adb -s $device shell dumpsys webviewupdate` 记录 WebView 版本。滚动冲突应在模拟器上实际滑动，并核对页面是否重新加载、历史位置、输入区与弹窗；需要时同时检查空会话、长消息和图片。一次模拟器验证不等于实体手机及所有 WebView 版本的验收。

## 结束

关闭对照浏览器和网站进程，停止独立调试 App，并仅移除本次使用的 ADB 转发：

```powershell
adb -s $device shell am force-stop org.viprpg.archive.localdebug
adb -s $device reverse --remove tcp:443
adb -s $device forward --remove tcp:9335
```

如需继续使用这份 APK，保留它及配套的 `localhost-cert.pem`、`localhost-key.pem`。下次创建新隔离目录时复制这两个文件，跳过重新生成证书及 APK 构建，再按上述步骤准备数据、启动服务和建立转发；使用 APK 的实际包名启动，证书过期后需重新生成并重建 APK。若不再需要该隔离环境，先确认没有其他进程或任务使用它，再核对解析后的目录属于仓库 `output`，仅将本次目录移入回收站：

```powershell
$resolved = (Resolve-Path -LiteralPath $testDir).Path
$outputRoot = (Resolve-Path -LiteralPath (Join-Path $repo 'output')).Path.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $resolved.StartsWith($outputRoot, [StringComparison]::OrdinalIgnoreCase)) { throw '目标不在仓库 output 内' }
$links = @(Get-ChildItem -LiteralPath $resolved -Force -Recurse -Attributes ReparsePoint)
if ($links.Count) { throw '目标包含链接，需先检查' }
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($resolved, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
```

固定种子恢复另会在 `output/local-seed/` 写入带时间戳的验证报告；只清理由本次任务生成且不再需要的报告。不要清理其他任务的状态、截图、APK、ADB 转发或模拟器数据。是否恢复 ADB 的非 root 状态需考虑同一模拟器上的其他连接；`adb unroot` 同样会重启 ADB 服务。
