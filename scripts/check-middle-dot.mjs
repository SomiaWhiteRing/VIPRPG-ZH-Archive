import { spawnSync } from "node:child_process";

const pattern = [
  String.fromCodePoint(0xb7),
  "(&middot|&[Cc]enter[Dd]ot|&#0*183|&#[xX]0*[bB]7);",
  String.raw`\\([uU]00[bB]7|u\{0*[bB]7\}|x[bB]7|0{0,4}[bB]7([^[:xdigit:]]|$))`,
].join("|");

const result = spawnSync("git", [
  "grep", "--threads", "4", "-I", "-n", "-o", "-E", "-e", pattern, "--", ".",
  // Reference data keeps the source names, original filenames and kaomoji characters.
  ":(exclude)data/character-classification-bootstrap.json",
  ":(exclude)data/character-dictionary.json",
  ":(exclude)lib/archive/rtp-upload-catalog.json",
  ":(exclude)docs/eternal-sea-kaomoji-characters.json",
], { stdio: "inherit" });

if (result.error) throw result.error;
if (result.status === 1) {
  console.log("中点分隔符检查通过");
} else {
  if (result.status === 0) console.error("项目自写内容禁用 U+00B7 分隔符。请按字段关系改用布局、标点或自然短语。");
  process.exitCode = result.status || 1;
}
