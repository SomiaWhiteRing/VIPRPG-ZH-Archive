const APP_ROOT = "viprpg-archive";
const GAMES_ROOT = "games";

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

export async function writeGameIndexJson(
  playKey: string,
  indexJson: string,
): Promise<void> {
  await writeGameRootTextFile(playKey, "index.json", indexJson);
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
