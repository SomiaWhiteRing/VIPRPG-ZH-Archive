import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError } from "@/lib/http";
import type { SeaSubmission } from "@/lib/dto/sea";
import { layoutSeaDialogue } from "@/lib/ui/eternal-sea";
import type { SeaActor } from "./identity";

export function seaRoom(runtime: AppRuntime) { return runtime.env.SEA_ROOM.getByName("public"); }
export function seaSubmission(value: Record<string, unknown>, actor: SeaActor): SeaSubmission {
  if (typeof value.clientMessageId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.clientMessageId))
    throw new HttpError(400, "提交编号无效");
  if (typeof value.body !== "string" || Array.from(value.body).some(character => {
    const code = character.charCodeAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  }))
    throw new HttpError(400, "发言内容无效");
  const body = value.body.replace(/\r\n?/g, "\n");
  if (!body.trim() || !layoutSeaDialogue(actor.name, body).fits) throw new HttpError(400, "发言超出对话框容量");
  if (value.avatarMode !== "own" && value.avatarMode !== "alex") throw new HttpError(400, "头像选择无效");
  return { clientMessageId: value.clientMessageId, body, avatarMode: actor.userId === null ? "alex" : value.avatarMode };
}
