import { DEFAULT_ACCOUNT_SHORTCUTS, parseAccountShortcuts } from "@/lib/account-preferences";
import type { AppRuntime } from "../runtime";

export async function updateAccountPreferences(runtime: AppRuntime, userId: number, form: FormData) {
  const raw = form.get("shortcuts");
  if (typeof raw !== "string" || raw.length > 512) throw new Error("快捷入口列表无效，请刷新后重试。");
  const shortcuts = parseAccountShortcuts(JSON.parse(raw));
  const serialized = JSON.stringify(shortcuts);
  const showInteractionData = form.has("showGameCardInteractionData")
    ? form.getAll("showGameCardInteractionData").includes("1") ? 1 : 0
    : null;
  await runtime.db.prepare(`UPDATE users SET notify_uploaded_work_comments=?,include_player_in_zip=?,show_game_card_interaction_data=COALESCE(?,show_game_card_interaction_data),account_shortcuts=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(form.get("notifyUploadedWorkComments") === "1" ? 1 : 0, form.get("includePlayerInZip") === "1" ? 1 : 0,
      showInteractionData,
      serialized === JSON.stringify(DEFAULT_ACCOUNT_SHORTCUTS) ? null : serialized, userId).run();
}
