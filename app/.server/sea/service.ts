import { DEFAULT_UI_LOCALE, type UiLocale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/core";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError } from "@/lib/http";
import { SEA_ANONYMOUS_NAME_LIMIT, SEA_FACE_COUNT, type SeaSubmission } from "@/lib/dto/sea";
import { layoutSeaBody } from "@/lib/ui/eternal-sea";
import type { SeaActor } from "./identity";
import type { CharacterPortrait } from "@/lib/character-names";
import { PUBLIC_CHARACTER_PORTRAIT_CONDITION } from "@/app/.server/db/character-portrait-library";

export function seaRoom(runtime: AppRuntime) { return runtime.env.SEA_ROOM.getByName("public"); }
export async function seaSubmission(value: Record<string, unknown>, actor: SeaActor, db: D1Database, locale: UiLocale = DEFAULT_UI_LOCALE): Promise<SeaSubmission & { portrait?: CharacterPortrait }> {
  if (typeof value.clientMessageId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.clientMessageId))
    throw new HttpError(400, translate(locale, "sea.requestId"));
  if (typeof value.body !== "string" || Array.from(value.body).some(character => {
    const code = character.charCodeAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  }))
    throw new HttpError(400, translate(locale, "sea.invalidBody"));
  const body = value.body.replace(/\r\n?/g, "\n");
  if (value.avatarMode !== "own" && value.avatarMode !== "alex") throw new HttpError(400, translate(locale, "sea.avatar.invalid"));
  const avatarMode = actor.userId === null ? "alex" : value.avatarMode;
  let anonymousName: string | undefined;
  let faceIndex: number | undefined;
  let portrait: CharacterPortrait | undefined;
  if (avatarMode === "alex") {
    if (value.anonymousName !== undefined) {
      if (typeof value.anonymousName !== "string" || value.anonymousName.length > SEA_ANONYMOUS_NAME_LIMIT
        || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value.anonymousName))
        throw new HttpError(400, translate(locale, "sea.invalidName"));
      anonymousName = value.anonymousName.trim() || undefined;
    }
    if (value.faceIndex !== undefined) {
      if (typeof value.faceIndex !== "number" || !Number.isInteger(value.faceIndex)
        || value.faceIndex < 0 || value.faceIndex >= SEA_FACE_COUNT)
        throw new HttpError(400, translate(locale, "sea.avatar.invalid"));
      faceIndex = value.faceIndex || undefined;
    }
  }
  const layout = layoutSeaBody(body);
  if (!layout.fits) throw new HttpError(400, translate(locale, "sea.capacity"));
  if (!layout.hasContent) throw new HttpError(400, translate(locale, "sea.invalidBody"));
  if (avatarMode === "alex" && value.portrait !== undefined) {
    const choice = value.portrait as Partial<CharacterPortrait> | null;
    const id = choice?.faceSheetId;
    const row = choice?.row;
    const column = choice?.column;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1
      || typeof row !== "number" || !Number.isSafeInteger(row) || row < 0
      || typeof column !== "number" || !Number.isSafeInteger(column) || column < 0)
      throw new HttpError(400, translate(locale, "sea.avatar.invalid"));
    const sheet = await db.prepare(`SELECT id AS faceSheetId, blob_sha256 AS blobSha256,
      width_px AS width, height_px AS height FROM face_sheets portrait_sheet
      WHERE id=? AND ?<height_px/48 AND ?<width_px/48 AND ${PUBLIC_CHARACTER_PORTRAIT_CONDITION}`)
      .bind(id, row, column).first<Omit<CharacterPortrait, "row" | "column">>();
    if (!sheet) throw new HttpError(400, translate(locale, "sea.avatar.invalid"));
    portrait = { ...sheet, row, column };
  }
  return { clientMessageId: value.clientMessageId, body, avatarMode, anonymousName, faceIndex, portrait };
}
