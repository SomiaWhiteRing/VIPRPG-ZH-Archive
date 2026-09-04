import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const sourcePath = resolve(args.source || ".wrangler/tmp/atwiki-face-source.json");
const outputDirectory = resolve(args.output || ".wrangler/tmp/atwiki-face-downloads");
const outputPath = resolve(
  args.manifest || ".wrangler/tmp/atwiki-face-source-downloaded.json",
);
const concurrency = Math.max(1, Math.min(24, Number(args.concurrency) || 12));
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
if (
  source.schema !== "viprpg-atwiki-face-source.v2" ||
  !Array.isArray(source.images) ||
  source.images.some((image) => !Number.isSafeInteger(image.sourceOrder) || image.sourceOrder < 0)
) {
  throw new Error("atwiki 脸图 URL 清单格式不合法");
}
mkdirSync(outputDirectory, { recursive: true });

let cursor = 0;
let completed = 0;
let downloaded = 0;
let reused = 0;
let failed = 0;
const startedAt = Date.now();
const results = new Array(source.images.length);
const timer = setInterval(reportProgress, 15_000);

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (cursor < source.images.length) {
      const index = cursor++;
      const image = source.images[index];
      try {
        results[index] = await download(image);
      } catch (error) {
        failed += 1;
        results[index] = {
          ...image,
          downloadError: error instanceof Error ? error.message : String(error),
        };
      } finally {
        completed += 1;
      }
    }
  }),
);
clearInterval(timer);
reportProgress();

const failures = results.filter((image) => image.downloadError);
writeFileSync(
  outputPath,
  `${JSON.stringify({
    schema: "viprpg-atwiki-face-source-downloaded.v2",
    images: results,
  }, null, 2)}\n`,
);
if (failures.length) {
  console.error(
    JSON.stringify({
      failures: failures.length,
      sample: failures.slice(0, 10).map((image) => ({
        src: image.src,
        error: image.downloadError,
      })),
    }, null, 2),
  );
  process.exitCode = 1;
}

async function download(image) {
  const urlHash = createHash("sha256").update(image.src).digest("hex");
  const existingPath = ["png", "bmp", "jpg"]
    .map((extension) => join(outputDirectory, `${urlHash}.${extension}`))
    .find(existsSync);
  if (existingPath) {
    const bytes = readFileSync(existingPath);
    inspectImage(bytes, image);
    reused += 1;
    return { ...image, localPath: existingPath };
  }
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(image.src, {
        headers: { "user-agent": "Mozilla/5.0 VIPRPG-ZH-Archive importer" },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const inspected = inspectImage(bytes, image);
      const localPath = join(outputDirectory, `${urlHash}.${inspected.extension}`);
      const temporaryPath = `${localPath}.partial`;
      writeFileSync(temporaryPath, bytes);
      renameSync(temporaryPath, localPath);
      downloaded += 1;
      return { ...image, localPath };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(attempt * 500);
    }
  }
  throw new Error(
    `${basename(new URL(image.src).pathname)} 下载失败：${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function inspectImage(bytes, image) {
  let format;
  let width;
  let height;
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    if (bytes.length >= 26 && bytes.toString("ascii", 0, 2) === "BM") {
      format = "bmp";
      width = Math.abs(bytes.readInt32LE(18));
      height = Math.abs(bytes.readInt32LE(22));
    } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      format = "jpg";
      ({ width, height } = readJpegDimensions(bytes));
    } else {
      throw new Error("响应不是支持的 PNG、BMP 或 JPEG 图像");
    }
  } else {
    format = "png";
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  }
  if (
    width !== Number(image.width) ||
    height !== Number(image.height) ||
    width < 48 ||
    height < 48 ||
    width > 192 ||
    height > 192 ||
    width % 48 !== 0 ||
    height % 48 !== 0
  ) {
    throw new Error(`图片尺寸不合法：${width}×${height}`);
  }
  return { extension: format, width, height };
}

function readJpegDimensions(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error("JPEG 缺少尺寸信息");
}

function reportProgress() {
  console.log(
    JSON.stringify({
      completed,
      total: source.images.length,
      downloaded,
      reused,
      failed,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    }),
  );
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    result[value.slice(2)] = values[index + 1];
    index += 1;
  }
  return result;
}
