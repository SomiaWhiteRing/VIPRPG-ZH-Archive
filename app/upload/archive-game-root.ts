import { UiFeedbackError } from "@/lib/i18n/feedback";

export function filesWithinArchiveGameRoot<T extends { path: string }>(
  entries: T[],
  format: string,
): T[] {
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
  return entries
    .filter((entry) => entry.path.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((entry) => ({ ...entry, path: entry.path.slice(prefix.length) }))
    .sort((left, right) =>
      left.path.toLowerCase().localeCompare(right.path.toLowerCase()),
    );
}
