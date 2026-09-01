"use strict";

const FETCH_IMAGE_MESSAGE = "viprpg-material-cropper:fetch-image";
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== FETCH_IMAGE_MESSAGE) {
    return false;
  }

  fetchAtwikiImage(message.url, sender)
    .then((image) => sendResponse({ ok: true, ...image }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "无法读取图片。",
      });
    });

  return true;
});

async function fetchAtwikiImage(rawUrl, sender) {
  assertAllowedSender(sender);

  const imageUrl = new URL(rawUrl);
  if (
    imageUrl.protocol !== "https:" ||
    imageUrl.hostname !== "img.atwiki.jp" ||
    !imageUrl.pathname.startsWith("/viprpg_sozai/attach/")
  ) {
    throw new Error("该图片不属于 VIPRPG 素材附件。");
  }

  const response = await fetch(imageUrl.href, {
    cache: "force-cache",
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`图片读取失败（HTTP ${response.status}）。`);
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error("附件不是可处理的图片。");
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error("图片超过 16 MB，未进行处理。");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("图片超过 16 MB，未进行处理。");
  }

  return {
    dataUrl: `data:${contentType};base64,${bytesToBase64(bytes)}`,
  };
}

function assertAllowedSender(sender) {
  const rawPageUrl = sender.url ?? sender.tab?.url;
  const pageUrl = new URL(rawPageUrl);
  if (
    pageUrl.protocol !== "https:" ||
    pageUrl.hostname !== "w.atwiki.jp" ||
    !pageUrl.pathname.startsWith("/viprpg_sozai/pages/")
  ) {
    throw new Error("请求并非来自 VIPRPG 素材页。");
  }
}

function bytesToBase64(bytes) {
  const chunks = [];
  const chunkSize = 32_768;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }

  return btoa(chunks.join(""));
}
