import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { migrationManifest } from "./deployment-config.mjs";

const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const summary = [
  "## 正式发布候选", "", `Commit: \`${sha}\``, "", "目标：https://viprpg.org", "",
  "部署前自动核对 D1 迁移账本：有待应用迁移时执行，没有时直接继续部署；迁移失败则停止发布。", "",
  "手动选择 production 并运行 workflow 即确认本次发布及候选中的待应用迁移；候选检查通过后直接部署，无需再次 Review deployments。", "",
  "迁移清单（已经应用的迁移不会重跑）：", "", "| 文件 | SHA-256（LF） |", "| --- | --- |",
  ...migrationManifest().map(({ name, sha256 }) => `| ${name} | ${sha256} |`), "",
  "正式资源来自 production Environment 的专用配置。新资源、首次初始化和数据修复须先按正式部署手册准备并确认；本流程不重建数据库或导入种子。", "",
].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
