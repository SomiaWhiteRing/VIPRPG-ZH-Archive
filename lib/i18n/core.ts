import { IntlMessageFormat, type FormatXMLElementFn } from "intl-messageformat";
import { DEFAULT_UI_LOCALE, type UiLocale } from "./locale";
import { zh } from "./messages/zh-Hans";
import { ja } from "./messages/ja";
import { en } from "./messages/en";

export type MessageKey = keyof typeof zh;
export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === "string" && Object.hasOwn(zh, value);
}
const messages: Record<UiLocale, Record<MessageKey, string>> = { "zh-Hans": zh, ja, en };

const formatters = new Map<string, IntlMessageFormat>();

export function formatMessage<T>(locale: UiLocale, id: MessageKey, values?: Record<string, string | number | FormatXMLElementFn<T>>) {
  const key = `${locale}:${id}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    const message = messages[locale][id];
    formatter = new IntlMessageFormat(message ?? zh[id], message === undefined ? DEFAULT_UI_LOCALE : locale);
    formatters.set(key, formatter);
  }
  return formatter.format<T>(values);
}

export function translate(locale: UiLocale, id: MessageKey, values?: Record<string, string | number>) {
  return formatMessage<string>(locale, id, values).toString();
}
