import type { FaceEmoji, FaceEmojiCell } from "@/lib/face-emojis";
import { emojiToken } from "@/lib/face-emojis";
import type { ClipboardEvent } from "react";

export function emojiCells(cells: FaceEmojiCell[]): FaceEmojiCell[] {
  return cells.map(({ blobSha256, row, column }) => ({
    blobSha256,
    row,
    column,
  }));
}

export function copyFaceEmojis(event: ClipboardEvent<HTMLElement>) {
  if (
    event.target instanceof HTMLElement &&
    event.target.closest('input,textarea,[contenteditable="true"]')
  )
    return;
  const selection = window.getSelection();
  if (!selection?.rangeCount || event.defaultPrevented) return;
  const content = document.createElement("div");
  content.appendChild(selection.getRangeAt(0).cloneContents());
  const cells = content.querySelectorAll<HTMLElement>("[data-face-emoji]");
  if (!cells.length) return;
  event.clipboardData.setData("text/html", content.innerHTML);
  for (const cell of cells)
    cell.replaceWith(emojiToken(Number(cell.dataset.faceEmoji)));
  for (const lineBreak of content.querySelectorAll("br"))
    lineBreak.replaceWith("\n");
  for (const block of content.querySelectorAll("p,div,li"))
    block.appendChild(document.createTextNode("\n"));
  event.clipboardData.setData(
    "text/plain",
    content.innerText || content.textContent || "",
  );
  event.preventDefault();
}
export async function emojiRequest<T>(
  url = "/api/emojis",
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    signal,
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = (await response.json()) as T & {
    detail?: string;
    error?: string;
  };
  if (!response.ok)
    throw new Error(result.detail ?? result.error ?? "表情加载失败。");
  return result;
}
export async function resolveEmojis(
  ids: number[],
  signal?: AbortSignal,
): Promise<FaceEmoji[]> {
  const result: FaceEmoji[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const params = new URLSearchParams({ op: "resolve" });
    ids
      .slice(start, start + 100)
      .forEach((id) => params.append("id", String(id)));
    result.push(
      ...(
        await emojiRequest<{ emojis: FaceEmoji[] }>(
          `/api/emojis?${params}`,
          undefined,
          signal,
        )
      ).emojis,
    );
  }
  return result;
}
