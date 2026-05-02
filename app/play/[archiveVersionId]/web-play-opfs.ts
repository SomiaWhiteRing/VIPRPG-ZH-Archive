const APP_ROOT = "viprpg-archive";
const GAMES_ROOT = "games";

export type GameOpfsWriteContext = {
  playKey: string;
  filesRoot: FileSystemDirectoryHandle;
  directoryCache: Map<string, Promise<FileSystemDirectoryHandle>>;
};

type FileSystemSyncAccessHandleLike = {
  write: (buffer: BufferSource, options?: { at?: number }) => number;
  flush?: () => void;
  truncate?: (size: number) => void;
  close: () => void;
};

type SyncAccessFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle?: () => Promise<FileSystemSyncAccessHandleLike>;
};

export async function ensureOpfsSupported(): Promise<void> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };

  if (!storage.getDirectory) {
    throw new Error("当前浏览器不支持 OPFS，本地安装不可用。");
  }
}

export async function resetGameOpfsDirectory(playKey: string): Promise<void> {
  await ensureOpfsSupported();
  const gamesRoot = await getGamesRootDirectory(true);

  await gamesRoot
    .removeEntry(playKey, { recursive: true })
    .catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) {
        throw error;
      }
    });
}

export async function deleteGameOpfsDirectory(playKey: string): Promise<void> {
  await resetGameOpfsDirectory(playKey);
}

export async function writeGameFile(
  playKey: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const writeContext = await createGameOpfsWriteContext(playKey);

  await writeGameFileWithContext(writeContext, relativePath, bytes);
}

export async function createGameOpfsWriteContext(
  playKey: string,
): Promise<GameOpfsWriteContext> {
  const filesRoot = await getFilesDirectory(playKey, true);
  const directoryCache = new Map<string, Promise<FileSystemDirectoryHandle>>();

  directoryCache.set("", Promise.resolve(filesRoot));

  return {
    playKey,
    filesRoot,
    directoryCache,
  };
}

export async function writeGameFileWithContext(
  context: GameOpfsWriteContext,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const file = await getGameFileHandle(context, relativePath);
  const syncFile = file as SyncAccessFileHandle;
  const writeBuffer = toWriteBuffer(bytes);

  if (typeof syncFile.createSyncAccessHandle === "function") {
    const accessHandle = await syncFile.createSyncAccessHandle();

    try {
      accessHandle.truncate?.(0);
      accessHandle.write(writeBuffer);
      accessHandle.flush?.();
    } finally {
      accessHandle.close();
    }
    return;
  }

  const writable = await file.createWritable();

  await writable.write(writeBuffer);
  await writable.close();
}

export async function createGameFileWritable(
  playKey: string,
  relativePath: string,
): Promise<FileSystemWritableFileStream> {
  const writeContext = await createGameOpfsWriteContext(playKey);
  const file = await getGameFileHandle(writeContext, relativePath);

  return file.createWritable();
}

async function getGameFileHandle(
  context: GameOpfsWriteContext,
  relativePath: string,
): Promise<FileSystemFileHandle> {
  const normalizedPath = normalizeGameRelativePath(relativePath);
  const parts = normalizedPath.split("/");
  const fileName = parts.pop();

  if (!fileName) {
    throw new Error(`非法文件路径：${relativePath}`);
  }

  const directory = await getCachedDirectory(context, parts);

  return directory.getFileHandle(fileName, { create: true });
}

export async function writeGameIndexJson(
  playKey: string,
  indexJson: string,
): Promise<void> {
  const gameRoot = await getGameRootDirectory(playKey, true);
  const file = await gameRoot.getFileHandle("index.json", { create: true });
  const writable = await file.createWritable();

  await writable.write(indexJson);
  await writable.close();
}

async function getGamesRootDirectory(create: boolean): Promise<FileSystemDirectoryHandle> {
  const storage = navigator.storage as StorageManager & {
    getDirectory: () => Promise<FileSystemDirectoryHandle>;
  };
  const root = await storage.getDirectory();
  const appRoot = await root.getDirectoryHandle(APP_ROOT, { create });

  return appRoot.getDirectoryHandle(GAMES_ROOT, { create });
}

async function getGameRootDirectory(
  playKey: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const gamesRoot = await getGamesRootDirectory(create);

  return gamesRoot.getDirectoryHandle(playKey, { create });
}

async function getFilesDirectory(
  playKey: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const gameRoot = await getGameRootDirectory(playKey, create);

  return gameRoot.getDirectoryHandle("files", { create });
}

function normalizeGameRelativePath(path: string): string {
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
    throw new Error(`非法文件路径：${path}`);
  }

  return normalized
    .split("/")
    .filter(Boolean)
    .join("/");
}

function getCachedDirectory(
  context: GameOpfsWriteContext,
  parts: string[],
): Promise<FileSystemDirectoryHandle> {
  let parentPromise = context.directoryCache.get("");
  let currentPath = "";

  if (!parentPromise) {
    parentPromise = Promise.resolve(context.filesRoot);
    context.directoryCache.set("", parentPromise);
  }

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;

    let directoryPromise = context.directoryCache.get(currentPath);

    if (!directoryPromise) {
      directoryPromise = parentPromise.then((parent) =>
        parent.getDirectoryHandle(part, { create: true }),
      );
      context.directoryCache.set(currentPath, directoryPromise);
    }

    parentPromise = directoryPromise;
  }

  return parentPromise;
}

function toWriteBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes as Uint8Array<ArrayBuffer>;
  }

  const copy = new Uint8Array(bytes.byteLength);

  copy.set(bytes);

  return copy;
}
