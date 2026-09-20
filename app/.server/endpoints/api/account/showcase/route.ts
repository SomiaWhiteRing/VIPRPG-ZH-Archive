import { requireUser } from "@/app/.server/auth/guards";
import {
  readCharacterPickerCategories,
  readCharacterPickerPage,
} from "@/app/.server/db/character-picker";
import { getD1 } from "@/app/.server/db/d1";
import {
  findShowcaseTargets,
  parseShowcaseInput,
  readShowcase,
  saveShowcase,
} from "@/app/.server/db/showcase";
import { readJsonObject, parsePositiveId } from "@/app/.server/http/request";
import { readShowcasePortraitSheets } from "@/app/.server/db/showcase-portraits";
import type { AppRuntime } from "@/app/.server/runtime";
import { HttpError, json, jsonError } from "@/lib/http";
import { isShowcaseKind } from "@/lib/showcase";

export async function GET(runtime: AppRuntime, request: Request) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    const op = params.get("op");
    if (op === "portraits") {
      const characterId = parsePositiveId(
        params.get("characterId") ?? "",
        "角色",
      );
      const offset = Number(params.get("offset") ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new HttpError(400, "分页位置无效。");
      const [target] = await findShowcaseTargets(runtime, "character", {
        id: characterId,
      });
      if (!target) throw new HttpError(404, "角色不存在。");
      return json({
        ...(await readShowcasePortraitSheets(
          getD1(runtime),
          characterId,
          offset,
        )),
        defaultPortrait: target.portrait,
      });
    }
    if (op === "categories") {
      return json({
        items: await readCharacterPickerCategories(getD1(runtime)),
      });
    }
    if (op === "characters") {
      const offset = Number(params.get("offset") ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw new HttpError(400, "分页位置无效。");
      return json(
        await readCharacterPickerPage(
          getD1(runtime),
          params.get("q") ?? "",
          offset,
          params.get("categoryId"),
        ),
      );
    }
    if (op !== null) throw new HttpError(400, "未知展柜查询。");
    const kind = params.get("kind");
    if (kind !== null) {
      if (!isShowcaseKind(kind)) throw new HttpError(400, "展柜类型不合法");
      return json({
        ok: true,
        targets: await findShowcaseTargets(runtime, kind, {
          query: params.get("q") ?? "",
        }),
      });
    }
    return json({ ok: true, ...(await readShowcase(runtime, auth.user.id)) });
  } catch (error) {
    return jsonError("展柜读取失败", error);
  }
}

export async function PUT(runtime: AppRuntime, request: Request) {
  const auth = await requireUser(runtime, request);
  if ("response" in auth) return auth.response;
  try {
    const input = parseShowcaseInput(
      await readJsonObject(request, "展柜内容格式不合法"),
    );
    await saveShowcase(runtime, auth.user, input);
    return json({ ok: true });
  } catch (error) {
    return jsonError("展柜保存失败", error);
  }
}
