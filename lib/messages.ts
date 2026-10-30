import { bodyLength } from "./face-emojis";
import { HttpError } from "./http";

export const MESSAGE_BODY_LENGTH = 4000;
export const MESSAGE_IMAGE_BYTES = 2 * 1024 * 1024;
export const MESSAGE_PAGE_SIZE = 40;

export function messageClientId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))
    throw new HttpError(400, "消息编号无效");
  return value;
}

export function messageBody(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "消息内容无效");
  const body = value.replace(/\r\n?/g, "\n").trim();
  if (!body || body.length > 16000 || bodyLength(body) > MESSAGE_BODY_LENGTH
    || [...body].some(character => { const code = character.charCodeAt(0); return (code < 32 && code !== 9 && code !== 10) || code === 127; }))
    throw new HttpError(400, "消息不能为空或超过 4000 字");
  return body;
}
