import { UiFeedbackError } from "@/lib/i18n/feedback";

export function splitArchiveGameRoot<T extends { path: string }>(
  entries: T[],
  format: string,
) {
  const roots = entries.filter((entry) =>
    /(?:^|\/)rpg_rt\.lmt$/i.test(entry.path),
  );
  if (!roots.length) {
    throw new UiFeedbackError("upload.feedback.archiveLmtMissing", { format });
  }
  if (roots.length > 1) {
    throw new UiFeedbackError("upload.feedback.archiveLmtMultiple", { format });
  }
  const rootPath = roots[0].path;
  const prefix = rootPath.slice(0, rootPath.lastIndexOf("/") + 1);
  const files: T[] = [];
  const outside: T[] = [];
  for (const entry of entries) {
    if (entry.path.toLowerCase().startsWith(prefix.toLowerCase())) {
      files.push({ ...entry, path: entry.path.slice(prefix.length) });
    } else {
      outside.push(entry);
    }
  }
  files.sort((left, right) => left.path.toLowerCase().localeCompare(right.path.toLowerCase()));
  return { gameRoot: prefix.slice(0, -1), files, outside };
}
