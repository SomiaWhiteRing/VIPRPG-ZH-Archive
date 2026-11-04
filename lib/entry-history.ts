import { AUDIT_FIELD_LABELS, auditRecord, entityAuditChanges, type AuditFieldChange } from "./entity-audit";
import { creatorRoleLabel, engineLabel, languageLabel, namespaceLabel, relationLabel, workStatusLabel } from "./labels";
import { CHARACTER_ROLE_LABELS, type CharacterRoleKey } from "./character-names";

export type EntryHistoryKind = "work" | "creator" | "character";

export function entryHistoryValueText(field: string, value: unknown): string {
  if (value == null || value === "") return "（空）";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.length ? value.map(item => entryHistoryValueText(field, item)).join("\n\n") : "（空）";
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => {
    const label = AUDIT_FIELD_LABELS[key] ?? key;
    return `${label}：${entryHistoryValueText(label, item)}`;
  }).join("\n") || "（空）";
  if (typeof value === "string") {
    switch (field.split(" / ").at(-1)) {
      case "语言": return languageLabel(value);
      case "引擎": return engineLabel(value);
      case "状态": return workStatusLabel(value);
      case "职务／登场定位": return CHARACTER_ROLE_LABELS[value as CharacterRoleKey] ?? creatorRoleLabel(value);
      case "标签分类": return namespaceLabel(value);
      case "类型": return relationLabel(value);
      case "日期精度": return ({ year: "年", month: "月", day: "日" } as Record<string, string>)[value] ?? value;
    }
  }
  return String(value);
}

export function entryHistoryChanges(detail: unknown, kind: EntryHistoryKind, id: number): AuditFieldChange[] {
  const { before, after } = entryHistorySnapshots(detail, kind, id);
  return entityAuditChanges(before, after);
}

/** Reconstruct the endpoints from chronological, operation-scoped snapshots before diffing. */
export function entryHistoryRangeChanges(details: unknown[], kind: EntryHistoryKind, id: number): AuditFieldChange[] {
  const edits = details.flatMap(detail => {
    const record = auditRecord(detail);
    return record && Object.hasOwn(record, "before") && Object.hasOwn(record, "after") ? [entryHistorySnapshots(detail, kind, id)] : [];
  });
  let before: Record<string, unknown> | null = null;
  for (const edit of [...edits].reverse()) before = applyHistoryEdit(before, edit.after, edit.before);
  let after = before;
  for (const edit of edits) after = applyHistoryEdit(after, edit.before, edit.after);
  return entityAuditChanges(before, after);
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
  if (kind === "character" && record.id === undefined && (Array.isArray(record.memberships) || Array.isArray(record.sources))) {
    return Object.fromEntries(["memberships", "sources"].flatMap(key => Array.isArray(record[key])
      ? [[key, record[key].filter(value => auditRecord(value)?.characterId === id).map(value => {
        const { characterId: _characterId, ...row } = value as Record<string, unknown>;
        return key === "sources" ? row.url : row;
      })]] : []));
  }
  return record;
}
