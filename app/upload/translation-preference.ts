import type { ConfirmedCreatorSelection } from "@/lib/creator-names";
export type UploadTranslationPreferenceV2 = {
  version: 2;
  isTranslation: boolean;
  translators: ConfirmedCreatorSelection[] | null;
};

export function readTranslationPreference(
  userId: number,
): UploadTranslationPreferenceV2 | null {
  try {
    const raw = localStorage.getItem(preferenceKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value) ||
      value.version !== 2 ||
      typeof value.isTranslation !== "boolean" ||
      !(value.translators === null || (Array.isArray(value.translators) && value.translators.every(isSelection)))
    ) {
      return null;
    }
    return {
      version: 2,
      isTranslation: value.isTranslation,
      translators: value.translators as ConfirmedCreatorSelection[] | null,
    };
  } catch {
    return null;
  }
}

export function updateTranslationPreference(
  userId: number,
  patch: Partial<Pick<UploadTranslationPreferenceV2, "isTranslation" | "translators">>,
): void {
  try {
    const current = readTranslationPreference(userId) ?? {
      version: 2 as const,
      isTranslation: false,
      translators: null,
    };
    const next: UploadTranslationPreferenceV2 = {
      version: 2,
      isTranslation: patch.isTranslation ?? current.isTranslation,
      translators: Object.hasOwn(patch, "translators")
        ? patch.translators ?? null
        : current.translators,
    };
    localStorage.setItem(preferenceKey(userId), JSON.stringify(next));
  } catch {
    // Browser preferences are optional and must never block editing or submission.
  }
}

function preferenceKey(userId: number): string {
  return `viprpg.upload.translation-preference.v2:${userId}`;
}

export function rememberPublishedTranslators(userId: number, translators: ConfirmedCreatorSelection[]): void {
  // Declarations and explicitly cleared selections are saved by the form.
  // An empty result can also be a non-translation; it must not change either preference.
  if (translators.length) updateTranslationPreference(userId, { translators });
}

function isSelection(value: unknown): value is ConfirmedCreatorSelection {
  return isRecord(value) && typeof value.name === "string" && Boolean(value.name.trim()) &&
    typeof value.displayName === "string" && Boolean(value.displayName.trim()) &&
    value.kind === "existing" && Number.isSafeInteger(value.creatorId) && Number(value.creatorId) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
