import fs from "node:fs";
import { execFileSync } from "node:child_process";

const originalCpSync = fs.cpSync.bind(fs);

fs.cpSync = function cpSync(source, destination, options = {}) {
  if (process.platform !== "win32" || !options?.recursive) {
    return originalCpSync(source, destination, options);
  }

  const stat = fs.statSync(source);

  if (!stat.isDirectory()) {
    return originalCpSync(source, destination, options);
  }

  const command = [
    "& { param($src, $dest)",
    "$ErrorActionPreference='Stop'",
    "New-Item -ItemType Directory -Force -Path $dest | Out-Null",
    "Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force",
    "}",
  ].join("; ");

  execFileSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
    source,
    destination,
  ], {
    stdio: "inherit",
  });
};
