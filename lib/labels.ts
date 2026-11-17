import { isMessageKey, translate, type MessageKey } from "./i18n/core";
import { DEFAULT_UI_LOCALE, type UiLocale } from "./i18n/locale";

const CREATOR_ROLE_KEYS = {
  author: "work.credit.author",
  scenario: "work.credit.scenario",
  graphics: "work.credit.graphics",
  planning: "work.credit.planning",
  programming: "work.credit.programming",
  translator: "work.credit.translator",
  music: "work.credit.music",
  other: "work.credit.other",
} as const satisfies Record<string, MessageKey>;
const languageNames = new Map<UiLocale, Intl.DisplayNames>();

const NAMESPACE_LABELS: Record<string, string> = {
  genre: "类型",
  theme: "主题",
  character: "角色相关",
  technical: "技术",
  content: "内容",
  other: "其他",
};

export const LANGUAGE_OPTIONS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "ja", label: "日语" },
  { value: "en", label: "英语" },
  { value: "zh-TW", label: "繁体中文" },
  { value: "ko", label: "韩语" },
  { value: "fr", label: "法语" },
  { value: "de", label: "德语" },
  { value: "es", label: "西班牙语" },
  { value: "ru", label: "俄语" },
  { value: "pt-BR", label: "葡萄牙语（巴西）" },
  { value: "it", label: "意大利语" },
  { value: "th", label: "泰语" },
  { value: "vi", label: "越南语" },
] as const;

export const ENGINE_OPTIONS = [
  { value: "rpg_maker_2000", label: "RPG Maker 2000", shortLabel: "2k", distribution: "archive" },
  { value: "rpg_maker_2003", label: "RPG Maker 2003", shortLabel: "2k3", distribution: "archive" },
  { value: "rpg_maker_2003_maniac", label: "RPG Maker 2003 Maniac", shortLabel: "2k3 Maniac", distribution: "archive" },
  { value: "rpg_maker_xp", label: "RPG Maker XP", shortLabel: "XP", distribution: "external" },
  { value: "rpg_maker_vx", label: "RPG Maker VX", shortLabel: "VX", distribution: "external" },
  { value: "rpg_maker_vx_ace", label: "RPG Maker VX Ace", shortLabel: "VX Ace", distribution: "external" },
  { value: "rpg_maker_mv", label: "RPG Maker MV", shortLabel: "MV", distribution: "external" },
  { value: "rpg_maker_mz", label: "RPG Maker MZ", shortLabel: "MZ", distribution: "external" },
  { value: "rpg_maker_unite", label: "RPG Maker Unite", shortLabel: "Unite", distribution: "external" },
  { value: "other", label: "其他引擎", shortLabel: "其他引擎", distribution: "external" },
] as const;

export type ArchiveEngineFamily = Extract<
  (typeof ENGINE_OPTIONS)[number],
  { distribution: "archive" }
>["value"];

export function isArchiveEngineFamily(value: string): value is ArchiveEngineFamily {
  return ENGINE_OPTIONS.some(
    (option) => option.value === value && option.distribution === "archive",
  );
}

export function isEngineFamily(value: string): boolean {
  return ENGINE_OPTIONS.some(
    (option) => option.value === value,
  );
}

const RELATION_LABEL_KEYS = {
  adaptation: "relation.adaptation",
  prequel: "relation.prequel",
  sequel: "relation.sequel",
  same_setting: "relation.same_setting",
  alternative_setting: "relation.alternative_setting",
  alternative_version: "relation.alternative_version",
  character: "relation.character",
  collaboration: "relation.collaboration",
  version: "relation.version",
  main_version: "relation.main_version",
  collection: "relation.collection",
  in_collection: "relation.in_collection",
} as const satisfies Record<string, MessageKey>;

const RELATION_INVERSE: Record<string, string | null> = {
  adaptation: "adaptation",
  prequel: "sequel",
  sequel: "prequel",
  same_setting: "same_setting",
  alternative_setting: "alternative_setting",
  alternative_version: "alternative_version",
  character: "character",
  collaboration: null,
  version: "main_version",
  main_version: "version",
  collection: "in_collection",
  in_collection: "collection",
};

export const WORK_RELATION_TYPES = Object.freeze(Object.keys(RELATION_LABEL_KEYS));
export const TRANSLATION_ROLE_LABELS = {
  original: "原版",
  translation: "译版",
} as const;

export const WORK_EXTERNAL_LINK_OPTIONS = [
  { value: "official", label: "官方网站" },
  { value: "wiki", label: "Wiki" },
  { value: "source", label: "来源" },
  { value: "video", label: "视频" },
  { value: "other", label: "其他" },
] as const;

export const IMPORT_TASK_STATUS_OPTIONS = [
  { value: "created", label: "已创建" },
  { value: "preflighted", label: "准备上传文件" },
  { value: "uploading_source", label: "上传游戏文件" },
  { value: "awaiting_metadata", label: "等待作品资料" },
  { value: "uploading_metadata", label: "上传资料图片" },
  { value: "committing", label: "提交入库" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
  { value: "canceled", label: "已取消" },
  { value: "expired", label: "已过期" },
] as const;


export const VERIFICATION_EMAIL_HINT =
  "验证码已发送至 {email}，未收到时请检查垃圾邮件。";

export function engineLabel(value: string, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  const option = ENGINE_OPTIONS.find((option) => option.value === value);
  return !option || option.value === "other" ? translate(locale, "work.otherEngine") : option.label;
}

export function engineShortLabel(value: string, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  const option = ENGINE_OPTIONS.find((option) => option.value === value);
  return !option || option.value === "other" ? translate(locale, "work.otherEngine") : option.shortLabel;
}

export function creatorRoleLabel(value: string, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  return Object.hasOwn(CREATOR_ROLE_KEYS, value)
    ? translate(locale, CREATOR_ROLE_KEYS[value as keyof typeof CREATOR_ROLE_KEYS])
    : value;
}

export function namespaceLabel(value: string): string {
  return NAMESPACE_LABELS[value] ?? value;
}

export function languageLabel(value: string | null | undefined, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  const option = LANGUAGE_OPTIONS.find((item) => item.value === value);
  if (!option) return value ?? translate(locale, "work.unknownLanguage");
  if (locale === DEFAULT_UI_LOCALE) return option.label;
  let names = languageNames.get(locale);
  if (!names) {
    names = new Intl.DisplayNames(locale, { type: "language" });
    languageNames.set(locale, names);
  }
  const displayCode = option.value === "zh-CN" ? "zh-Hans" : option.value === "zh-TW" ? "zh-Hant" : option.value;
  return names.of(displayCode) ?? option.label;
}

export function isLanguageCode(value: unknown): value is (typeof LANGUAGE_OPTIONS)[number]["value"] {
  return typeof value === "string" && LANGUAGE_OPTIONS.some((option) => option.value === value);
}

export function relationLabel(value: string, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  return Object.hasOwn(RELATION_LABEL_KEYS, value)
    ? translate(locale, RELATION_LABEL_KEYS[value as keyof typeof RELATION_LABEL_KEYS])
    : value;
}

export function relationInverse(value: string): string | null {
  return RELATION_INVERSE[value] ?? null;
}

export function workStatusLabel(value: string, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  switch (value) {
    case "published":
    case "hidden":
    case "processing":
    case "deleted":
      return translate(locale, `upload.own.status.${value}`);
    default:
      return value;
  }
}

export function archiveStatusLabel(
  value: string,
  purgedAt: string | null = null,
  locale: UiLocale = DEFAULT_UI_LOCALE,
): string {
  if (purgedAt) {
    return translate(locale, "admin.archives.purged");
  }
  switch (value) {
    case "published":
    case "hidden":
    case "processing":
      return workStatusLabel(value, locale);
    case "deleted":
      return translate(locale, "admin.archives.trash");
    default:
      return value;
  }
}

export function inboxStatusLabel(value: string, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  switch (value) {
    case "open":
      return translate(locale, "inbox.status.open");
    case "pending":
      return translate(locale, "inbox.status.pending");
    case "approved":
      return translate(locale, "inbox.approved");
    case "rejected":
      return translate(locale, "inbox.rejected");
    case "archived":
      return translate(locale, "inbox.status.archived");
    default:
      return value;
  }
}

export function importTaskStatusLabel(value: string, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  const key = `admin.imports.status.${value}`;
  return isMessageKey(key) ? translate(locale, key) : value;
}

export function importTaskStageLabel(value: string, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  if (value === "preflight") {
    return translate(locale, "admin.imports.stagePreflight");
  }
  if (value === "commit") {
    return translate(locale, "admin.imports.status.committing");
  }
  const key = `upload.phase.${value === "source_verification" ? "verifying_source" : value}`;
  return isMessageKey(key) ? translate(locale, key) : value;
}

export function installStatusLabel(value: string, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  const key = `play.install.status.${value}`;
  return isMessageKey(key) ? translate(locale, key) : value;
}


export function userStatusLabel(value: string, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  return translate(locale, value === "deleted" ? "admin.users.deleted" : value === "active" ? "admin.users.activeBadge" : "admin.users.disabledBadge");
}
