import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const reportRoot = resolve(projectRoot, "output", "regression");
const runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
const runRoot = join(reportRoot, runId);
const stages = ["check", "test"];
const options = new Set(process.argv.slice(2));

if (options.has("--flow")) stages.push("test:flow");
if (options.has("--build")) stages.push("build");
const unknownOptions = [...options].filter((option) => !["--flow", "--build"].includes(option));
if (unknownOptions.length > 0) {
  console.error(`unknown option: ${unknownOptions.join(", ")}`);
  console.error("usage: node scripts/regression.mjs [--flow] [--build]");
  process.exitCode = 2;
} else {
  await runRegression();
}

async function runRegression() {
  mkdirSync(runRoot, { recursive: true });
  const report = {
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "running",
    stages: stages.map((name) => ({ name, status: "pending" })),
    worktree: collectWorktreeState(),
    logs: [],
  };
  const reportPath = join(runRoot, "report.json");
  writeReport(reportPath, report);

  console.log(`[regression] worktree: ${report.worktree.dirty ? "dirty (preserved)" : "clean"}`);
  console.log(`[regression] stages: ${stages.join(" -> ")}`);

  for (const stage of report.stages) {
    stage.status = "running";
    stage.startedAt = new Date().toISOString();
    const logPath = join(runRoot, `${stage.name.replaceAll(":", "-")}.log`);
    stage.log = relative(projectRoot, logPath).replaceAll("\\", "/");
    report.logs.push(stage.log);
    writeReport(reportPath, report);

    const result = await runNpmScript(stage.name, logPath);
    stage.finishedAt = new Date().toISOString();
    stage.exitCode = result.exitCode;
    stage.status = result.exitCode === 0 ? "passed" : "failed";
    if (result.exitCode !== 0) {
      stage.failureClass = classifyFailure(result.output);
      report.status = "failed";
      report.finishedAt = stage.finishedAt;
      writeReport(reportPath, report);
      console.error(`[regression] ${stage.name} failed (${stage.failureClass})`);
      console.error(`[regression] evidence: ${relative(projectRoot, logPath)}`);
      console.error(`[regression] report: ${relative(projectRoot, reportPath)}`);
      process.exitCode = result.exitCode || 1;
      return;
    }
    writeReport(reportPath, report);
  }

  report.status = "passed";
  report.finishedAt = new Date().toISOString();
  writeReport(reportPath, report);
  console.log(`[regression] passed; report: ${relative(projectRoot, reportPath)}`);
}

function runNpmScript(scriptName, logPath) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolveResult) => {
    const child = spawn(npmCommand, ["run", scriptName], {
      cwd: projectRoot,
      env: { ...process.env, CI: process.env.CI ?? "1" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      windowsHide: true,
    });
    writeFileSync(logPath, `=== npm run ${scriptName} (${new Date().toISOString()}) ===\n`, "utf8");
    let output = "";
    const collect = (chunk) => {
      const text = chunk.toString();
      output += text;
      appendFileSync(logPath, text);
      process.stdout.write(text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      const text = `${error.stack ?? error}\n`;
      output += text;
      appendFileSync(logPath, text);
      resolveResult({ exitCode: 1, output });
    });
    child.on("close", (exitCode) => resolveResult({ exitCode: exitCode ?? 1, output }));
  });
}

function collectWorktreeState() {
  const result = spawnSync("git", ["status", "--short"], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  const status = result.status === 0 ? result.stdout.trimEnd() : "git status unavailable";
  return {
    dirty: status.length > 0,
    changedPathCount: status ? status.split(/\r?\n/).length : 0,
    status,
  };
}

function classifyFailure(output) {
  const lowerOutput = output.toLowerCase();
  if (lowerOutput.includes("sqlite_busy") || lowerOutput.includes("database is locked")) return "scheduling";
  if (lowerOutput.includes("exceeded") && lowerOutput.includes("artifacts preserved")) return "test-harness";
  if (
    lowerOutput.includes("next.js dev-overlay") ||
    lowerOutput.includes("dev-overlay") ||
    lowerOutput.includes("locator") ||
    lowerOutput.includes("playwright")
  ) return "test-harness";
  if (
    lowerOutput.includes("eacces") ||
    lowerOutput.includes("eperm") ||
    lowerOutput.includes("permission denied") ||
    lowerOutput.includes("command not found") ||
    lowerOutput.includes("enoent")
  ) return "environment";
  return "unknown-product-or-harness";
}

function writeReport(reportPath, report) {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
