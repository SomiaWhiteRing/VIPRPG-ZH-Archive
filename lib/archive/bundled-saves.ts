import type { ArchiveSourceManifest, ExcludedFileTypeSummary } from "./manifest";
import { isArchiveSave } from "./save-name";
import { classifyArchivePath } from "./file-policy";

// Classify the selected files when serializing a manifest. Drafts keep their
// original selection so a resumed upload can still deselect an uploaded save.
export function includeSelectedSaves(manifest: ArchiveSourceManifest) {
  const saves = manifest.extras?.filter(file => isArchiveSave(file.path)) ?? [];
  if (!saves.length) return saves;
  manifest.files = [...manifest.files, ...saves].sort((a, b) => a.pathSortKey.localeCompare(b.pathSortKey));
  manifest.extras = manifest.extras!.filter(file => !isArchiveSave(file.path));
  if (!manifest.extras.length) delete manifest.extras;
  const bytes = saves.reduce((total, file) => total + file.size, 0);
  manifest.archiveVersion.includedFileCount += saves.length;
  manifest.archiveVersion.includedSize += bytes;
  manifest.archiveVersion.excludedFileCount -= saves.length;
  manifest.archiveVersion.excludedSize -= bytes;
  return saves;
}

export function remainingExcludedTypes(types: ExcludedFileTypeSummary[], saves: { path: string; size: number }[]) {
  if (!saves.length) return types;
  const counts = new Map(types.map(item => [item.fileType, { ...item }]));
  for (const save of saves) {
    const item = counts.get(classifyArchivePath(save.path).fileType);
    if (!item) continue;
    item.fileCount--;
    item.totalSizeBytes -= save.size;
    if (item.examplePath === save.path) item.examplePath = "";
    if (item.fileCount === 0) counts.delete(item.fileType);
  }
  return [...counts.values()];
}
