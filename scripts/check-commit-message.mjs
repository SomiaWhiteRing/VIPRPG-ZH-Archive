import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("请提供提交信息文件路径。");
const message = execFileSync("git", ["stripspace", "--strip-comments"], {
  input: readFileSync(path, "utf8"),
  encoding: "utf8",
});
const lines = message.trim().split(/\r?\n/);
const violations = [];
if (!/^\p{Script=Han}/u.test(lines[0])) {
  violations.push("标题必须以中文开头，直接说明改动，不使用英文类型前缀。");
}

let fence = null;
for (const [index, line] of lines.slice(1).entries()) {
  const marker = line.trim().match(/^(`{3,}|~{3,})/);
  if (marker) {
    if (!fence) fence = marker[1];
    else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
    continue;
  }
  if (fence || !line.trim()) continue;
  if (/^(?:Co-authored-by|Signed-off-by|Reviewed-by|Acked-by|Tested-by|Reported-by|Suggested-by|Change-Id|Fixes|Refs):\s+\S/i.test(line)) continue;
  const prose = line.replace(/`[^`]+`|https?:\/\/\S+/g, "").trim();
  if (/[\p{L}\p{N}]/u.test(prose) && !/\p{Script=Han}/u.test(prose)) {
    violations.push(`正文第 ${index + 2} 行必须使用中文；命令和代码请放入反引号或代码块。`);
  }
}
if (fence) violations.push("正文中的代码块必须闭合。");
if (violations.length) {
  console.error("提交已阻止：提交信息必须使用中文。\n" + violations.map((item) => `  ${item}`).join("\n"));
  process.exitCode = 1;
}
