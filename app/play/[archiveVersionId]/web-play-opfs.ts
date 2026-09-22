const APP_ROOT = "viprpg-archive";
const GAMES_ROOT = "games";

export type WebPlayPackage = {
  blob: File;
  metadata: { files: { filename: string; start: number; end: number }[] };
};

/** Mount installed bytes directly in the player's Worker, without resource HTTP requests. */
export async function readGamePackages(
  playKey: string,
  archiveVersionId: number,
  manifestSha256: string,
  signal: AbortSignal,
): Promise<WebPlayPackage[]> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(playKey)) throw new Error("非法游戏安装标识。");
  const root = await getGameRootDirectory(playKey, false);
  signal.throwIfAborted();
  const indexFile = await (await root.getFileHandle("pack-index.json")).getFile();
  const index: unknown = JSON.parse(await indexFile.text());
  if (!index || typeof index !== "object" || !("version" in index) || index.version !== 1 ||
      !("archiveVersionId" in index) || index.archiveVersionId !== archiveVersionId ||
      !("manifestSha256" in index) || index.manifestSha256 !== manifestSha256 ||
      !("packs" in index) || !Array.isArray(index.packs) ||
      !("files" in index) || !index.files || typeof index.files !== "object" || Array.isArray(index.files)) {
    throw new Error("本地游戏索引不匹配，请重新安装游戏。");
  }
  const packsRoot = await root.getDirectoryHandle("packs");
  const packages = new Map<string, WebPlayPackage>();
  for (const pack of index.packs) {
    signal.throwIfAborted();
    if (!pack || typeof pack.name !== "string" || !Number.isSafeInteger(pack.size) || pack.size < 0 || packages.has(pack.name))
      throw new Error("本地资源包索引无效。");
    const blob = await (await packsRoot.getFileHandle(normalizePackName(pack.name))).getFile();
    if (blob.size !== pack.size) throw new Error(`本地资源包不完整：${pack.name}`);
    packages.set(pack.name, { blob, metadata: { files: [] } });
  }
  const paths = new Set<string>();
  const directories = new Set<string>();
  for (const record of Object.values(index.files)) {
    if (!record || typeof record.path !== "string" || typeof record.pack !== "string" ||
        !Number.isSafeInteger(record.offset) || !Number.isSafeInteger(record.length) ||
        record.offset < 0 || record.length < 0) throw new Error("本地游戏文件索引无效。");
    // WORKERFS builds a directory tree using ordinary JS objects.
    if (record.path.includes("\\") || record.path.includes("\0") ||
        record.path.split("/").some((part: string) => !part || part === "." || part === ".." ||
          Object.prototype.hasOwnProperty.call(Object.prototype, part)) ||
        paths.has(record.path) || directories.has(record.path)) throw new Error(`非法本地游戏路径：${record.path}`);
    const parts = record.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const directory = parts.slice(0, i).join("/");
      if (paths.has(directory)) throw new Error(`本地游戏路径冲突：${record.path}`);
      directories.add(directory);
    }
    const pack = packages.get(record.pack);
    const end = record.offset + record.length;
    if (!pack || !Number.isSafeInteger(end) || end > pack.blob.size)
      throw new Error(`本地游戏文件范围无效：${record.path}`);
    paths.add(record.path);
    pack.metadata.files.push({ filename: `/${record.path}`, start: record.offset, end });
  }
  signal.throwIfAborted();
  return [...packages.values()];
}

export async function ensureOpfsSupported(): Promise<void> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };

  if (!storage.getDirectory) {
    throw new Error("当前浏览器不支持所需的本地存储，无法安装游戏。");
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

export async function createGamePackWritable(
  playKey: string,
  packName: string,
): Promise<FileSystemWritableFileStream> {
  const gameRoot = await getGameRootDirectory(playKey, true);
  const packsRoot = await gameRoot.getDirectoryHandle("packs", { create: true });
  const file = await packsRoot.getFileHandle(normalizePackName(packName), {
    create: true,
  });

  return file.createWritable();
}

export async function writeGamePackIndexJson(
  playKey: string,
  indexJson: string,
): Promise<void> {
  await writeGameRootTextFile(playKey, "pack-index.json", indexJson);
}

async function writeGameRootTextFile(
  playKey: string,
  fileName: string,
  text: string,
): Promise<void> {
  const gameRoot = await getGameRootDirectory(playKey, true);
  const file = await gameRoot.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();

  await writable.write(text);
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

function normalizePackName(name: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*\.pack$/.test(name)) {
    throw new Error(`非法 pack 文件名：${name}`);
  }

  return name;
}
