export const MATCHES_PATH = "/admin/netplay-spaces/matches";

export const END_REASONS: Readonly<Record<string, string>> = {
  settled: "正常结算",
  closed: "连接关闭",
  peer_left: "对手离开",
  interrupted: "强退后补传",
  finish_timeout: "终局超时",
  finish_mismatch: "终局不一致",
  user_cancel: "取消对局",
  next_match: "进入下一局",
  match_end: "对局结束",
};

export function endReasonLabel(reason: string | null) {
  return reason ? Object.hasOwn(END_REASONS, reason) ? END_REASONS[reason] : reason : "—";
}
