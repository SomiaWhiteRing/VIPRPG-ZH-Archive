const DB_NAME = "viprpg_web_play_v1";
const DB_VERSION = 1;
const STORE_INSTALLATIONS = "web_play_installations";
const APP_ROOT = "viprpg-archive";
const GAMES_ROOT = "games";
const packIndexCache = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const gameRequest = parseGameRequest(event.request.url);

  if (!gameRequest) {
    return;
  }

  if (gameRequest.error) {
    event.respondWith(handleInvalidGameRequest(gameRequest));
    return;
  }

  event.respondWith(handleGameRequest(gameRequest));
});

async function handleInvalidGameRequest(gameRequest) {
  notifyFileProblem(gameRequest.playKey, gameRequest.path, gameRequest.error);

  return new Response(gameRequest.error, {
    status: 400,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

async function handleGameRequest(gameRequest) {
  try {
    if (!(await isReadyInstallation(gameRequest.playKey))) {
      return new Response("Game is not installed", {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    return readGameResponse(gameRequest.playKey, gameRequest.path);
  } catch (error) {
    notifyFileProblem(
      gameRequest.playKey,
      gameRequest.path,
      error instanceof Error ? error.message : "File not found",
    );

    return new Response("Game file not found", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
}

function parseGameRequest(rawUrl) {
  const url = new URL(rawUrl);
  const marker = "/games/";
  const markerIndex = url.pathname.indexOf(marker);

  if (markerIndex < 0) {
    return null;
  }

  let rest;

  try {
    rest = decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
  } catch {
    return {
      error: "Invalid encoded game path",
      path: null,
      playKey: null,
    };
  }

  const [playKey, ...pathParts] = rest.split("/");
  const rawPath = pathParts.join("/") || "index.json";

  if (!playKey) {
    return {
      error: "Missing play key",
      path: rawPath,
      playKey: null,
    };
  }

  const path = normalizeGamePath(rawPath);

  if (!path) {
    return {
      error: "Invalid game file path",
      path: rawPath,
      playKey,
    };
  }

  return {
    playKey,
    path,
  };
}

function normalizeGamePath(path) {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");

  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.endsWith("/..") ||
    normalized === ".." ||
    /^[a-z]+:/i.test(normalized)
  ) {
    return null;
  }

  return normalized
    .split("/")
    .filter(Boolean)
    .join("/");
}

async function readGameResponse(playKey, path) {
  const storage = self.navigator.storage;

  if (!storage || typeof storage.getDirectory !== "function") {
    throw new Error("OPFS is not available in Service Worker");
  }

  const root = await storage.getDirectory();
  const appRoot = await root.getDirectoryHandle(APP_ROOT);
  const gamesRoot = await appRoot.getDirectoryHandle(GAMES_ROOT);
  const gameRoot = await gamesRoot.getDirectoryHandle(playKey);

  if (path === "index.json") {
    const file = await (await gameRoot.getFileHandle("index.json")).getFile();

    return fileResponse(file, "application/json; charset=utf-8");
  }

  const packIndex = await loadPackIndex(playKey, gameRoot);
  const record = packIndex.files[packLookupKey(path)];

  if (!record) {
    throw new Error(`Pack index entry not found: ${path}`);
  }

  const packFile = await getPackFile(gameRoot, record.pack);
  const start = record.offset;
  const end = record.offset + record.length;

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > packFile.size
  ) {
    throw new Error(`Pack index range is invalid: ${path}`);
  }

  const slice = packFile.slice(start, end, record.contentType || contentTypeForPath(path));

  return fileResponse(slice, record.contentType || contentTypeForPath(path));
}

function fileResponse(file, contentType) {
  return new Response(file.stream(), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Length": String(file.size),
      "Content-Type": contentType,
    },
  });
}

async function loadPackIndex(playKey, gameRoot) {
  let promise = packIndexCache.get(playKey);

  if (!promise) {
    promise = readPackIndex(gameRoot);
    packIndexCache.set(playKey, promise);
  }

  return promise;
}

async function readPackIndex(gameRoot) {
  const file = await (await gameRoot.getFileHandle("pack-index.json")).getFile();
  const index = JSON.parse(await file.text());

  if (index?.version !== 1 || !index.files || !Array.isArray(index.packs)) {
    throw new Error("Pack index is invalid");
  }

  return index;
}

async function getPackFile(gameRoot, packName) {
  if (!/^[a-z0-9][a-z0-9._-]*\.pack$/.test(packName)) {
    throw new Error(`Invalid pack name: ${packName}`);
  }

  const packsRoot = await gameRoot.getDirectoryHandle("packs");

  return (await packsRoot.getFileHandle(packName)).getFile();
}

function packLookupKey(path) {
  return path.toLowerCase();
}

async function isReadyInstallation(playKey) {
  const db = await openDb();
  const installation = await getValue(db, STORE_INSTALLATIONS, playKey);

  db.close();

  return installation && installation.status === "ready";
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_INSTALLATIONS)) {
        db.createObjectStore(STORE_INSTALLATIONS, { keyPath: "playKey" });
      }

      if (!db.objectStoreNames.contains("web_play_files")) {
        const store = db.createObjectStore("web_play_files", { keyPath: "id" });
        store.createIndex("playKey", "playKey", { unique: false });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function getValue(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

function notifyFileProblem(playKey, path, message) {
  self.clients
    .matchAll({ includeUncontrolled: true, type: "window" })
    .then((clients) => {
      for (const client of clients) {
        client.postMessage({
          type: "web-play-file-missing",
          playKey,
          path,
          message,
        });
      }
    })
    .catch(() => undefined);
}

function contentTypeForPath(path) {
  const ext = path.split(".").pop()?.toLowerCase() || "";

  switch (ext) {
    case "json":
      return "application/json; charset=utf-8";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "ico":
      return "image/x-icon";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "mp3":
      return "audio/mpeg";
    case "mid":
    case "midi":
      return "audio/midi";
    case "txt":
    case "ini":
      return "text/plain; charset=utf-8";
    case "ldb":
    case "lmt":
    case "lmu":
    case "xyz":
    case "exe":
    case "dll":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}
