export type ViewKind = "work" | "topic";
export type StatKind = ViewKind | "play";

export const VIEW_DAY_MS = 86_400_000;
export const VIEW_DAY_OFFSET_MS = 8 * 60 * 60 * 1000;
export const PLAY_COUNT_DESCRIPTION = "登录用户按账号去重；匿名访客在连续24小时内按指纹去重。在线启动、下载、外链下载页和Android安装共用计数。";

// A calendar day in UTC+8, shared by the client hint and server authority.
export function viewDay(now = Date.now()): number {
  return Math.floor((now + VIEW_DAY_OFFSET_MS) / VIEW_DAY_MS);
}
