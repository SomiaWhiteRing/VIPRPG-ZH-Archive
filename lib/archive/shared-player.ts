/** Original root executable omitted from storage; desktop ZIPs use the current Kai. */
export type SharedPlayerReplacement = { path: string; size: number };

export function isSharedPlayerPath(path: string): boolean {
  return path.toLowerCase() === "player.exe";
}
