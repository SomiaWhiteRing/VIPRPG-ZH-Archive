import { execFileSync } from "node:child_process";

// Inspect the index, not the working tree. Disable rename detection so moving
// an old migration into a new filename cannot evade the added-file count.
const added = execFileSync("git", [
  "diff", "--cached", "--name-only", "--diff-filter=A", "--no-renames", "-z",
], { encoding: "utf8" }).split("\0").filter(Boolean);
const migrations = added.filter((path) => /(?:^|\/)migrations\/[^/]+\.sql$/i.test(path));

if (migrations.length > 1) {
  console.error("提交已阻止：一个提交最多新增一个 SQL 迁移文件。\n" + migrations.map((path) => `  ${path}`).join("\n"));
  console.error("请先合并本次尚未发布的迁移，同步本地账本与固定开发种子，再重新暂存。已发布或远端已应用的迁移不可合并。钩子不会自动修改文件。");
  process.exitCode = 1;
}
