import { forumHistoryHref } from "./forum";

export const AUDIT_TARGET_LABELS = {
  work: "作品", creator: "作者", character: "角色", category: "角色分类", tag: "标签",
  comment: "评论／回复", forum_topic: "讨论主题", forum_post: "讨论楼层", forum_comment: "讨论楼内回复",
} as const;

export type EntityAuditTarget = { type: keyof typeof AUDIT_TARGET_LABELS; id: string | number; name: string | null };

export function auditRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function entityAuditTargets(detail: unknown): EntityAuditTarget[] {
  const data = auditRecord(detail);
  if (Array.isArray(data?.targets)) return data.targets.flatMap((value) => {
    const target = auditRecord(value);
    if (!target || typeof target.type !== "string" || !Object.hasOwn(AUDIT_TARGET_LABELS, target.type)
      || (typeof target.id !== "string" && typeof target.id !== "number")) return [];
    return [{ type: target.type as EntityAuditTarget["type"], id: target.id, name: typeof target.name === "string" ? target.name : null }];
  });
  // Older entries can identify the target, but lack complete edit history.
  return (["work", "creator", "character", "category"] as const).flatMap((type) => {
    const id = data?.[`${type}Id`];
    return typeof id === "string" || typeof id === "number" ? [{ type, id, name: null }] : [];
  });
}

export function entityAuditTargetHref(target: EntityAuditTarget): string {
  const id = encodeURIComponent(String(target.id));
  if (target.type === "work") return `/admin/works/${id}`;
  if (target.type === "creator") return `/admin/creators/${id}`;
  if (target.type === "character") return `/admin/characters/${id}`;
  if (target.type === "tag") return `/admin/tags/edit?name=${id}`;
  if (target.type === "comment") return `/admin/audit?targetType=comment&targetId=${id}`;
  if (target.type === "forum_topic") return forumHistoryHref({ kind: "topic", id: Number(target.id) });
  if (target.type === "forum_post" || target.type === "forum_comment") return forumHistoryHref({ kind: target.type === "forum_post" ? "post" : "comment", id: Number(target.id) });
  return `/admin/characters/index?category=${id}`;
}

const FIELD_LABELS: Record<string, string> = {
  name: "名称", primaryName: "中文名", originalName: "原名", originalTitle: "作品原名", chineseTitle: "中文标题",
  description: "简介", bio: "简介", aliases: "别名", links: "网站", avatarBlobSha256: "头像文件",
  genre: "类型", moreInfo: "附加信息", usesUnsupportedManiac: "特殊 Maniacs 功能", originalReleaseDate: "发布日期",
  releasePrecision: "日期精度", engineFamily: "引擎", isOriginal: "原创声明", isTranslation: "翻译声明", language: "语言", status: "状态",
  staff: "制作人员", creatorId: "作者 ID", creatorName: "作者名称", displayName: "显示名", roleKey: "职务／登场定位", roleLabel: "职务名称", notes: "备注",
  characters: "登场角色", characterId: "角色 ID", spoilerLevel: "剧透级别", sortOrder: "顺序", portrait: "头像",
  tags: "标签", namespace: "标签分类", media: "封面／截图", externalLinks: "外部链接", currentArchives: "当前归档", sourceUrl: "来源链接",
  sources: "来源链接", memberships: "分类归属", categoryId: "分类 ID", categories: "角色分类", parentId: "上级分类", label: "名称",
  faceSheets: "脸图绑定", defaultPortrait: "默认头像", materials: "素材绑定", sha256: "文件 SHA-256", kind: "素材类型", row: "行", column: "列",
  source: "合并来源", target: "合并目标", workCredits: "登场作品", workId: "作品 ID", relations: "作品关联",
  work: "作品", relatedCharacters: "涉及角色", translationRelations: "翻译关联", maintainers: "维护者",
  body: "正文", title: "标题", images: "配图", fingerprint: "图片 SHA-256", position: "顺序", offset: "正文位置",
  topicId: "讨论主题 ID", postId: "楼层 ID", postNumber: "楼层号", commentNumber: "楼内回复号", rootCommentId: "主评论 ID",
  replyToCommentId: "回复对象 ID", userId: "作者 ID", width: "宽度", height: "高度", size: "文件大小", format: "文件格式",
  authorName: "作者", createdAt: "发表时间",
  fromWorkId: "来源作品 ID", toWorkId: "目标作品 ID", type: "类型", inverse: "反向关系", createdByUserId: "创建者 ID", url: "网址", id: "ID",
};

export type AuditFieldChange = { field: string; before: unknown; after: unknown };

export function entityAuditChanges(before: unknown, after: unknown, path = ""): AuditFieldChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const left = auditRecord(before);
  const right = auditRecord(after);
  if ((left || right) && (left || before == null) && (right || after == null)) {
    return [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].flatMap((key) =>
      entityAuditChanges(left?.[key], right?.[key], path ? `${path} / ${FIELD_LABELS[key] ?? key}` : FIELD_LABELS[key] ?? key));
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const identity = (value: unknown) => {
      const row = auditRecord(value);
      if (!row) return null;
      if (row.id !== undefined) return `#${row.id}`;
      if (row.categoryId !== undefined && row.characterId !== undefined) return `${row.categoryId} / #${row.characterId}`;
      if (row.creatorId !== undefined) return `#${row.creatorId} / ${row.roleKey}`;
      if (row.characterId !== undefined) return `#${row.characterId}`;
      if (row.workId !== undefined) return `#${row.workId}`;
      if (row.url !== undefined) return String(row.url);
      if (row.sha256 !== undefined) return `${row.sha256} / ${row.role ?? row.kind ?? ""}`;
      return null;
    };
    const beforeKeys = before.map(identity);
    const afterKeys = after.map(identity);
    if (beforeKeys.every((key) => key !== null) && afterKeys.every((key) => key !== null)
      && new Set(beforeKeys).size === before.length && new Set(afterKeys).size === after.length) {
      const beforeMap = new Map(beforeKeys.map((key, i) => [key, before[i]]));
      const afterMap = new Map(afterKeys.map((key, i) => [key, after[i]]));
      const changes = [...new Set([...beforeKeys, ...afterKeys])].flatMap((key) =>
        entityAuditChanges(beforeMap.get(key), afterMap.get(key), `${path} / ${key}`));
      // Some ordered object lists do not have a separate sortOrder field.
      if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys) && beforeKeys.length === afterKeys.length && beforeKeys.every((key) => afterMap.has(key))) {
        changes.push({ field: `${path} / 顺序`, before: beforeKeys, after: afterKeys });
      }
      return changes;
    }
  }
  return [{ field: path || "条目", before, after }];
}
