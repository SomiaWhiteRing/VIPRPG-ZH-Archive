import { DEFAULT_ACCOUNT_SHORTCUTS, parseAccountShortcuts } from "@/lib/account-preferences";
import type { AppRuntime } from "../runtime";

export async function updateAccountPreferences(runtime: AppRuntime, userId: number, form: FormData) {
  const raw = form.get("shortcuts");
  if (typeof raw !== "string" || raw.length > 512) throw new Error("快捷入口列表无效，请刷新后重试。");
  const shortcuts = parseAccountShortcuts(JSON.parse(raw));
  const serialized = JSON.stringify(shortcuts);
  await runtime.db.prepare(`UPDATE users SET include_player_in_zip=?,account_shortcuts=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(form.get("includePlayerInZip") === "1" ? 1 : 0,
      serialized === JSON.stringify(DEFAULT_ACCOUNT_SHORTCUTS) ? null : serialized, userId).run();
}
