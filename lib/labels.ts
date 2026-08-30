const CREATOR_ROLE_LABELS: Record<string, string> = {
  author: "作者",
  scenario: "剧本",
  graphics: "图像",
  music: "音乐",
  translator: "翻译",
  proofreader: "校对",
  image_editor: "修图",
  publisher: "发布",
  editor: "编辑",
  other: "其他",
};

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
  { value: "rpg_maker_2000", label: "RPG Maker 2000", distribution: "archive" },
  { value: "rpg_maker_2003", label: "RPG Maker 2003", distribution: "archive" },
  { value: "rpg_maker_2003_maniac", label: "RPG Maker 2003 Maniac", distribution: "archive" },
  { value: "rpg_maker_xp", label: "RPG Maker XP", distribution: "external" },
  { value: "rpg_maker_vx", label: "RPG Maker VX", distribution: "external" },
  { value: "rpg_maker_vx_ace", label: "RPG Maker VX Ace", distribution: "external" },
  { value: "rpg_maker_mv", label: "RPG Maker MV", distribution: "external" },
  { value: "rpg_maker_mz", label: "RPG Maker MZ", distribution: "external" },
  { value: "rpg_maker_unite", label: "RPG Maker Unite", distribution: "external" },
  { value: "mixed", label: "混合引擎", distribution: "external" },
  { value: "unknown", label: "未知", distribution: "external" },
  { value: "other", label: "其他引擎", distribution: "external" },
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

export function isExternalEngineFamily(value: string): boolean {
  return ENGINE_OPTIONS.some(
    (option) => option.value === value && option.distribution === "external",
  );
}

const RELATION_LABELS: Record<string, string> = {
  adaptation: "改编",
  prequel: "前传",
  sequel: "续集",
  same_setting: "相同世界观",
  alternative_setting: "不同世界观",
  alternative_version: "不同演绎",
  character: "角色出演",
  collaboration: "联动",
  version: "不同版本",
  main_version: "主版本",
  collection: "合集",
  in_collection: "收录作品",
};

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

export const WORK_RELATION_TYPES = Object.freeze(Object.keys(RELATION_LABELS));
export const TRANSLATION_ROLE_LABELS = {
  original: "原版",
  translation: "译版",
} as const;

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

const IMPORT_TASK_STATUS_LABELS = Object.fromEntries(
  IMPORT_TASK_STATUS_OPTIONS.map((option) => [option.value, option.label]),
) as Record<string, string>;


export const VERIFICATION_EMAIL_HINT =
  "验证码已发送至 {email}，未收到时请检查垃圾邮件。";

export function engineLabel(value: string): string {
  return ENGINE_OPTIONS.find((option) => option.value === value)?.label ?? "引擎未知";
}

export function engineShortLabel(value: string): string {
  switch (value) {
    case "rpg_maker_2000":
      return "RM2000";
    case "rpg_maker_2003":
      return "RM2003";
    case "rpg_maker_2003_maniac":
      return "Maniac";
    case "rpg_maker_xp":
      return "RMXP";
    case "rpg_maker_vx":
      return "RMVX";
    case "rpg_maker_vx_ace":
      return "VXAce";
    case "rpg_maker_mv":
      return "RMMV";
    case "rpg_maker_mz":
      return "RMMZ";
    case "rpg_maker_unite":
      return "Unite";
    case "mixed":
      return "混合";
    case "other":
      return "其他";
    default:
      return "未知";
  }
}

export function creatorRoleLabel(value: string): string {
  return CREATOR_ROLE_LABELS[value] ?? value;
}

export function namespaceLabel(value: string): string {
  return NAMESPACE_LABELS[value] ?? value;
}

export function languageLabel(value: string | null | undefined): string {
  return LANGUAGE_OPTIONS.find((option) => option.value === value)?.label ?? value ?? "未知语言";
}

export function isLanguageCode(value: unknown): value is (typeof LANGUAGE_OPTIONS)[number]["value"] {
  return typeof value === "string" && LANGUAGE_OPTIONS.some((option) => option.value === value);
}

export function relationLabel(value: string): string {
  return RELATION_LABELS[value] ?? value;
}

export function relationInverse(value: string): string | null {
  return RELATION_INVERSE[value] ?? null;
}

export function workStatusLabel(value: string): string {
  switch (value) {
    case "published":
      return "已发布";
    case "hidden":
      return "隐藏";
    case "processing":
      return "归档处理中";
    case "deleted":
      return "已删除";
    default:
      return value;
  }
}

export function archiveStatusLabel(
  value: string,
  purgedAt: string | null = null,
): string {
  if (purgedAt) {
    return "已最终清理";
  }
  switch (value) {
    case "published":
      return "已发布";
    case "hidden":
      return "隐藏";
    case "processing":
      return "归档处理中";
    case "deleted":
      return "回收站";
    default:
      return value;
  }
}

export function inboxStatusLabel(value: string): string {
  switch (value) {
    case "open":
      return "未处理";
    case "pending":
      return "待处理";
    case "approved":
      return "已通过";
    case "rejected":
      return "已驳回";
    case "archived":
      return "已处理";
    default:
      return value;
  }
}

export function importTaskStatusLabel(value: string): string {
  return IMPORT_TASK_STATUS_LABELS[value] ?? value;
}

export function importTaskStageLabel(value: string): string {
  if (value === "preflight") {
    return "上传前检查";
  }
  if (value === "commit") {
    return "提交入库";
  }
  return value;
}

export function installStatusLabel(value: string): string {
  switch (value) {
    case "loading":
      return "读取中";
    case "created":
      return "已创建";
    case "installing":
      return "安装中";
    case "ready":
      return "已安装";
    case "failed":
      return "安装失败";
    case "deleted":
      return "未安装";
    default:
      return value;
  }
}


export function userStatusLabel(value: string): string {
  return value === "active" ? "启用" : "禁用";
}
