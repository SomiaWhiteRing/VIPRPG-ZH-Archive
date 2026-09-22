export function filesWithinArchiveGameRoot<T extends { path: string }>(
  entries: T[],
  format: string,
): T[] {
  const roots = entries.filter((entry) =>
    /(?:^|\/)rpg_rt\.lmt$/i.test(entry.path),
  );
  if (!roots.length) {
    throw new Error(`${format} 内未找到 RPG_RT.lmt，请选择包含游戏文件的压缩包。`);
  }
  if (roots.length > 1) {
    throw new Error(
      `${format} 内找到多个 RPG_RT.lmt，无法确定游戏根目录；请每次只上传一个游戏。`,
    );
  }
  const rootPath = roots[0].path;
  const prefix = rootPath.slice(0, rootPath.lastIndexOf("/") + 1);
  return entries
    .filter((entry) => entry.path.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((entry) => ({ ...entry, path: entry.path.slice(prefix.length) }))
    .sort((left, right) =>
      left.path.toLowerCase().localeCompare(right.path.toLowerCase()),
    );
}
