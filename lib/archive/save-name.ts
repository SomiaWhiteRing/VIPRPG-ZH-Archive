export function saveName(name: string, allowDownloadSuffix = false): string | null {
  if (allowDownloadSuffix) name = name.replace(/ \([0-9]+\)(?=\.[^.]+$)/, "");
  const slot = /^Save([0-9]{2,6})\.(lsd|dyn)$/i.exec(name);
  if (slot) return `Save${slot[1]}.${slot[2].toLowerCase()}`;
  if (/^Save\.lgs$/i.test(name)) return "Save.lgs";
  if (!allowDownloadSuffix && /^SaveData\/Save\.lgs$/i.test(name)) return "SaveData/Save.lgs";
  return null;
}

export function isArchiveSave(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return /\.lsd$/i.test(name) || saveName(name) !== null;
}
