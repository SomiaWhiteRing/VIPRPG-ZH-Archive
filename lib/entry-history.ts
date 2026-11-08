import { auditRecord } from "./entity-audit";
import { creatorRoleLabel, engineLabel, LANGUAGE_OPTIONS, relationLabel, TRANSLATION_ROLE_LABELS, WORK_EXTERNAL_LINK_OPTIONS, WORK_RELATION_TYPES, workStatusLabel } from "./labels";
import { CHARACTER_ROLE_LABELS, isCharacterRoleKey } from "./character-names";
import { CHARACTER_MATERIAL_CATEGORIES } from "./character-materials";
import { WORK_AUDIENCE_OPTIONS } from "./work-visibility";

export type EntryHistoryKind = "work" | "creator" | "character";

export type EntryHistoryValue = {
  text?: string;
  image?: string;
  cell?: { row: number; column: number };
};

export type EntryHistoryNames = {
  works: ReadonlyMap<number, string>;
  users: ReadonlyMap<number, string>;
  categories: ReadonlyMap<string, string>;
  archives: ReadonlyMap<number, string>;
};

type Snapshot = Record<string, unknown> | null;

const text = (value: unknown) => typeof value === "string" ? value : "";
const yesNo = (value: unknown) => value === true || value === 1 ? "是" : value === false || value === 0 ? "否" : "";
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const records = (value: unknown) => array(value).flatMap(item => {
  const record = auditRecord(item);
  return record ? [record] : [];
});
const image = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)
  ? `/api/media/blobs/${value.toLowerCase()}` : undefined;

function language(value: unknown): string {
  const code = text(value).replace(/[-_]/g, "").toLowerCase();
  return code === "zh" ? "中文"
    : LANGUAGE_OPTIONS.find(option => option.value.replace(/-/g, "").toLowerCase() === code)?.label ?? (code ? "未知语言" : "");
}

function portrait(value: unknown): EntryHistoryValue {
  const { row, column, sha256 } = auditRecord(value) ?? {};
  if (typeof row !== "number" || typeof column !== "number" || ![0, 1, 2, 3].includes(row) || ![0, 1, 2, 3].includes(column)) return {};
  const src = image(sha256);
  return src ? { image: src, cell: { row, column } } : {};
}

function displaySnapshot(snapshot: Snapshot, kind: EntryHistoryKind, id: number, names: EntryHistoryNames) {
  const fields = new Map<string, EntryHistoryValue[]>();
  if (!snapshot) return fields;
  function add(label: string, ...values: EntryHistoryValue[]) {
    const visible = values.filter(value => value.text || value.image);
    if (visible.length) fields.set(label, [...(fields.get(label) ?? []), ...visible]);
  }
  function texts(label: string, ...values: unknown[]) {
    add(label, ...values.map(value => ({ text: text(value) })));
  }
  const lines = (...values: unknown[]) => values.map(text).filter(Boolean).join("\n");
  const links = (value: unknown) => records(value).map(row => lines(row.label, row.url));
  const credit = (row: Record<string, unknown>, character: boolean) => {
    const role = text(row.roleKey);
    const staffRole = creatorRoleLabel(role);
    const label = character ? (isCharacterRoleKey(role) ? CHARACTER_ROLE_LABELS[role] : "")
      : text(row.roleLabel) || (role && staffRole === role ? "其他" : staffRole);
    return [text(row.displayName) || text(row.creatorName), label, row.notes];
  };

  if (kind === "work") {
    texts("作品原名", snapshot.originalTitle);
    texts("中文标题", snapshot.chineseTitle);
    texts("别名", ...array(snapshot.aliases));
    texts("简介", snapshot.description);
    texts("类型", snapshot.genre);
    texts("参考时长", snapshot.referenceDuration);
    texts("更多信息", ...records(snapshot.moreInfo).map(row => lines(row.title, row.body)));
    const date = text(snapshot.originalReleaseDate);
    const precision = snapshot.releasePrecision;
    texts("发布日期", precision === "unknown" ? "" : date.slice(0, precision === "year" ? 4 : precision === "month" ? 7 : 10));
    texts("语言", language(snapshot.language));
    texts("引擎", typeof snapshot.engineFamily === "string" ? engineLabel(snapshot.engineFamily) : "");
    const status = text(snapshot.status);
    const statusLabel = workStatusLabel(status);
    texts("状态", status && statusLabel === status ? "未知状态" : statusLabel);
    texts("可见范围", WORK_AUDIENCE_OPTIONS.find(option => option.value === snapshot.audience)?.label);
    texts("在首页展示", yesNo(snapshot.showOnHome));
    texts("原创声明", yesNo(snapshot.isOriginal));
    texts("翻译声明", yesNo(snapshot.isTranslation));
    texts("特殊 Maniacs 功能", yesNo(snapshot.usesUnsupportedManiac));
    texts("制作人员", ...records(snapshot.staff).map(row => lines(...credit(row, false))));
    add("登场角色", ...records(snapshot.characters).map(row => ({
      text: lines(...credit(row, true), row.spoilerLevel ? "剧透" : ""),
      ...portrait(row.portrait),
    })));
    texts("标签", ...array(snapshot.tags));
    const media = records(snapshot.media);
    add("封面", ...media.filter(row => row.role === "cover").map(row => ({ image: image(row.sha256) })));
    add("截图", ...media.filter(row => row.role === "preview").map(row => ({ image: image(row.sha256) })));
    const externalLinks = records(snapshot.externalLinks);
    texts("外部链接", ...externalLinks.filter(row => row.type !== "download_page").map(row =>
      lines(row.label, row.url, WORK_EXTERNAL_LINK_OPTIONS.find(option => option.value === row.type)?.label)));
    texts("外部下载", ...links(externalLinks.filter(row => row.type === "download_page")));
    texts("当前归档", ...records(snapshot.currentArchives).map(row =>
      lines(typeof row.id === "number" ? names.archives.get(row.id) : null, row.sourceUrl) || "站内归档"));
    texts("维护者", ...array(snapshot.maintainers).map(value => typeof value === "number" ? names.users.get(value) ?? "已注销用户" : "").sort());
    for (const [key, label] of [["relations", "作品关联"], ["translationRelations", "翻译关联"]] as const) {
      const related = records(snapshot[key]).flatMap(row => {
        // The inverse row already has the correct label when this work is its source.
        if (row.fromWorkId !== id || typeof row.toWorkId !== "number") return [];
        const title = names.works.get(row.toWorkId);
        if (!title) return [];
        const type = text(row.type);
        const role = key === "relations" ? (WORK_RELATION_TYPES.includes(type) ? relationLabel(type) : "")
          : type === "original" || type === "translation" ? TRANSLATION_ROLE_LABELS[type] : "";
        return [lines(title, role)];
      });
      texts(label, ...related.sort());
    }
    return fields;
  }

  if (kind === "creator") {
    texts("姓名", snapshot.name);
    texts("别名", ...array(snapshot.aliases));
    texts("简介", snapshot.bio);
    texts("网站", ...links(snapshot.links));
    add("头像", { image: image(snapshot.avatarBlobSha256) });
  } else {
    texts("中文名", snapshot.primaryName);
    texts("日文名", snapshot.originalName);
    texts("简介", snapshot.description);
    texts("别名", ...array(snapshot.aliases).map(value => {
      const alias = auditRecord(value);
      return alias ? [text(alias.name), language(alias.language)].filter(Boolean).join(" · ") : text(value);
    }));
    texts("来源资料", ...array(snapshot.sources));
    texts("分类归属", ...records(snapshot.memberships).map(row => lines(
      names.categories.get(text(row.categoryId)) || row.categoryLabel || "分类",
      row.displayName, row.originalName,
    )).sort());
    add("默认头像", portrait(snapshot.defaultPortrait));
    add("脸图", ...records(snapshot.faceSheets).map(row => ({ image: image(row.sha256) })));
    const materials = records(snapshot.materials);
    for (const { kind, label } of CHARACTER_MATERIAL_CATEGORIES) {
      add(label, ...materials.filter(row => row.kind === kind).map(row => ({ image: image(row.sha256) })));
    }
  }
  texts(kind === "creator" ? "作品署名" : "登场作品", ...records(snapshot.workCredits).flatMap(row => {
    const title = typeof row.workId === "number" ? names.works.get(row.workId) : undefined;
    return title ? [lines(title, ...credit(row, kind === "character"))] : [];
  }).sort());
  return fields;
}

export function entryHistoryChanges(before: Snapshot, after: Snapshot, kind: EntryHistoryKind, id: number, names: EntryHistoryNames) {
  const previous = displaySnapshot(before, kind, id, names);
  const next = displaySnapshot(after, kind, id, names);
  return [...new Set([...previous.keys(), ...next.keys()])].flatMap(field => {
    const left = previous.get(field) ?? [];
    const right = next.get(field) ?? [];
    if (JSON.stringify(left) === JSON.stringify(right)) return [];
    if ([...left, ...right].every(value => value.image && !value.text && !value.cell)) {
      const leftImages = new Set(left.map(value => value.image));
      const rightImages = new Set(right.map(value => value.image));
      if (leftImages.size === left.length && rightImages.size === right.length) {
        // Compare the order among shared images so an insertion doesn't mark later images as moved.
        const sharedLeft = left.filter(value => rightImages.has(value.image));
        const sharedRight = right.filter(value => leftImages.has(value.image));
        const moved = new Set(sharedLeft.filter((value, index) => value.image !== sharedRight[index].image).map(value => value.image));
        return [{
          field,
          before: left.filter(value => !rightImages.has(value.image) || moved.has(value.image)),
          after: right.filter(value => !leftImages.has(value.image) || moved.has(value.image)),
        }];
      }
    }
    return [{ field, before: left, after: right }];
  });
}

function includesInOrder(values: EntryHistoryValue[], subset: EntryHistoryValue[]): boolean {
  const keys = subset.map(value => JSON.stringify(value));
  let index = 0;
  for (const value of values) {
    if (JSON.stringify(value) === keys[index]) index++;
  }
  return index === keys.length;
}

export function entryHistorySummary(changes: ReturnType<typeof entryHistoryChanges>): string {
  const groups: Record<"新增" | "移除" | "编辑", string[]> = { 新增: [], 移除: [], 编辑: [] };
  for (const { field, before, after } of changes) {
    if (before.length < after.length && includesInOrder(after, before)) groups.新增.push(field);
    else if (after.length < before.length && includesInOrder(before, after)) groups.移除.push(field);
    else groups.编辑.push(field);
  }
  return Object.entries(groups).flatMap(([action, fields]) =>
    fields.length ? [action + fields.join("、")] : []).join("，");
}

/** Reconstruct the endpoints from chronological, operation-scoped snapshots before diffing. */
export function entryHistoryRangeChanges(edits: ReturnType<typeof entryHistorySnapshots>[], kind: EntryHistoryKind, id: number, names: EntryHistoryNames) {
  let before: Record<string, unknown> | null = null;
  for (const edit of [...edits].reverse()) before = applyHistoryEdit(before, edit.after, edit.before);
  let after = before;
  for (const edit of edits) after = applyHistoryEdit(after, edit.before, edit.after);
  return entryHistoryChanges(before, after, kind, id, names);
}

function applyHistoryEdit(current: Record<string, unknown> | null, before: Record<string, unknown> | null, after: Record<string, unknown> | null): Record<string, unknown> | null {
  if (after === null) return null;
  const result = { ...(before === null ? {} : current) };
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after)])) {
    if (JSON.stringify(before?.[key]) === JSON.stringify(after[key])) {
      if (!Object.hasOwn(result, key)) result[key] = after[key];
    } else if ((key === "relations" || key === "translationRelations") && Array.isArray(before?.[key]) && Array.isArray(after[key])) {
      // Relation operations capture one pair; preserve the other pairs already reconstructed.
      type Relation = Record<string, unknown> & { id: number };
      const previous = before[key] as Relation[], next = after[key] as Relation[];
      const rows = new Map((Array.isArray(result[key]) ? result[key] as Relation[] : previous).map(row => [row.id, row]));
      for (const row of previous) if (!next.some(value => value.id === row.id)) rows.delete(row.id);
      for (const row of next) {
        const old = previous.find(value => value.id === row.id);
        rows.set(row.id, old ? applyHistoryEdit(rows.get(row.id) ?? old, old, row) as Relation : row);
      }
      result[key] = [...rows.values()].sort((left, right) => left.id - right.id);
    } else {
      // Keep explicit undefined tombstones so later partial snapshots cannot restore removed fields.
      result[key] = after[key];
    }
  }
  return result;
}

export function entryHistorySnapshots(detail: unknown, kind: EntryHistoryKind, id: number) {
  const record = auditRecord(detail);
  const snapshots = [entryHistorySnapshot(record?.before, kind, id), entryHistorySnapshot(record?.after, kind, id)];
  // Existing translation audit records used the same property as ordinary relations.
  if (kind === "work" && snapshots.some(snapshot => Array.isArray(snapshot?.relations)
    && snapshot.relations.some(value => ["original", "translation"].includes(String(auditRecord(value)?.type))))) {
    for (let index = 0; index < snapshots.length; index++) {
      const snapshot = snapshots[index];
      if (snapshot && Object.hasOwn(snapshot, "relations")) {
        const { relations, ...rest } = snapshot;
        snapshots[index] = { ...rest, translationRelations: relations };
      }
    }
  }
  return { before: snapshots[0], after: snapshots[1] };
}

function entryHistorySnapshot(value: unknown, kind: EntryHistoryKind, id: number): Record<string, unknown> | null {
  const record = auditRecord(value);
  if (!record) return null;
  if (kind === "work" && Object.hasOwn(record, "work")) return auditRecord(record.work);
  if (kind === "character" && Array.isArray(record.relatedCharacters)) {
    return record.relatedCharacters.map(auditRecord).find(row => row?.id === id) ?? null;
  }
  if (Object.hasOwn(record, "source") || Object.hasOwn(record, "target")) {
    return [record.source, record.target].map(auditRecord).find(row => row?.id === id) ?? null;
  }
  // Classification edits can affect several characters in a single transaction.
  if (kind === "character" && record.id === undefined && (Array.isArray(record.categories)
    || [...records(record.memberships), ...records(record.sources)].some(row => Object.hasOwn(row, "characterId")))) {
    const labels = new Map(records(record.categories).map(row => [row.id, row.label]));
    return Object.fromEntries(["memberships", "sources"].flatMap(key => Array.isArray(record[key])
      ? [[key, record[key].filter(value => auditRecord(value)?.characterId === id).map(value => {
        const { characterId: _characterId, ...row } = value as Record<string, unknown>;
        return key === "sources" ? row.url : { ...row, categoryLabel: labels.get(row.categoryId) };
      })]] : []));
  }
  return record;
}
