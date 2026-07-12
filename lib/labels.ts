const CREATOR_ROLE_LABELS: Record<string, string> = {
  author: "作者",
  scenario: "剧本",
  graphics: "图像",
  music: "音乐",
  translator: "翻译",
  proofreader: "校对",
  image_editor: "修图",
  publisher: "发布",
  repacker: "整理",
  editor: "编辑",
};

const NAMESPACE_LABELS: Record<string, string> = {
  genre: "类型",
  theme: "主题",
  character: "角色相关",
  technical: "技术",
  content: "内容",
  other: "其他",
};

const RELEASE_TYPE_LABELS: Record<string, string> = {
  original: "原始发布",
  translation: "汉化版",
  revision: "修正版",
  localized_revision: "本地化修正版",
  demo: "试玩版",
  event_submission: "活动投稿",
  patch_applied_full_release: "补丁整合版",
  repack: "重打包",
};

const BASE_VARIANT_LABELS: Record<string, string> = {
  original: "原版",
  remake: "重制版",
  other: "其他基底",
};

const IMPORT_TASK_STATUS_LABELS: Record<string, string> = {
  created: "已创建",
  preflighted: "检查完成",
  uploading: "上传中",
  committed: "已提交入库",
  completed: "已完成",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
};

type UserRole = "user" | "uploader" | "admin" | "super_admin";

export const VERIFICATION_EMAIL_HINT =
  "验证码已发送至 {email}，未收到时请检查垃圾邮件。";

export function engineLabel(value: string): string {
  switch (value) {
    case "rpg_maker_2000":
      return "RPG Maker 2000";
    case "rpg_maker_2003":
      return "RPG Maker 2003";
    case "mixed":
      return "混合引擎";
    case "other":
      return "其他引擎";
    default:
      return "引擎未知";
  }
}

export function creatorRoleLabel(value: string): string {
  return CREATOR_ROLE_LABELS[value] ?? value;
}

export function namespaceLabel(value: string): string {
  return NAMESPACE_LABELS[value] ?? value;
}

export function releaseTypeLabel(value: string): string {
  return RELEASE_TYPE_LABELS[value] ?? "其他";
}

export function baseVariantLabel(value: string): string {
  return BASE_VARIANT_LABELS[value] ?? value;
}

export function workStatusLabel(value: string): string {
  switch (value) {
    case "published":
      return "已发布";
    case "hidden":
      return "隐藏";
    case "draft":
      return "草稿";
    case "deleted":
      return "已删除";
    default:
      return value;
  }
}

export function workStatusBadgeClass(value: string): string {
  if (value === "published") {
    return "approved";
  }
  if (value === "hidden" || value === "deleted") {
    return "rejected";
  }
  return "pending";
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
    case "draft":
      return "草稿";
    case "deleted":
      return "回收站";
    default:
      return value;
  }
}

export function archiveStatusBadgeClass(
  value: string,
  purgedAt: string | null = null,
): string {
  if (purgedAt || value === "deleted") {
    return "rejected";
  }
  if (value === "published") {
    return "approved";
  }
  return "pending";
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
      return "已归档";
    default:
      return value;
  }
}

export function inboxStatusBadgeClass(value: string): string {
  if (value === "approved") {
    return "approved";
  }
  if (value === "rejected") {
    return "rejected";
  }
  return "pending";
}

export function importTaskStatusLabel(value: string): string {
  return IMPORT_TASK_STATUS_LABELS[value] ?? value;
}

export function importTaskStatusBadgeClass(value: string): string {
  if (value === "completed" || value === "succeeded" || value === "committed") {
    return "approved";
  }
  if (value === "failed" || value === "canceled") {
    return "rejected";
  }
  return "pending";
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

export function uploadTaskStatusLabel(value: string): string {
  switch (value) {
    case "running":
      return "处理中";
    case "paused":
      return "已暂停";
    case "needs_source_reselect":
      return "需要重新选择游戏目录或 ZIP";
    case "completed":
      return "完成";
    case "failed_recoverable":
      return "可重试失败";
    case "failed_terminal":
      return "终止失败";
    case "canceled":
      return "已取消";
    default:
      return "已创建";
  }
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

// 须与 lib/server/auth/roles.ts 的 roleLabel 保持一致。
export function roleLabel(role: UserRole): string {
  switch (role) {
    case "super_admin":
      return "超级管理员";
    case "admin":
      return "管理员";
    case "uploader":
      return "上传者";
    case "user":
      return "普通用户";
  }
}

export function userRoleBadgeClass(role: UserRole): string {
  return role === "super_admin" ? "super-admin" : role;
}

export function userStatusLabel(value: string): string {
  return value === "active" ? "启用" : "禁用";
}

export function userStatusBadgeClass(value: string): string {
  return value === "active" ? "approved" : "rejected";
}
