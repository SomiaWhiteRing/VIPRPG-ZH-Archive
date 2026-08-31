export type UploadTranslationPreferenceV1 = {
  version: 1;
  isTranslation: boolean;
  translatorText: string | null;
};

export function readTranslationPreference(
  userId: number,
): UploadTranslationPreferenceV1 | null {
  try {
    const raw = localStorage.getItem(preferenceKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      typeof value.isTranslation !== "boolean" ||
      !(
        value.translatorText === null ||
        typeof value.translatorText === "string"
      )
    ) {
      return null;
    }
    return {
      version: 1,
      isTranslation: value.isTranslation,
      translatorText: cleanTranslatorText(value.translatorText),
    };
  } catch {
    return null;
  }
}

export function updateTranslationPreference(
  userId: number,
  patch: Partial<Pick<UploadTranslationPreferenceV1, "isTranslation" | "translatorText">>,
): void {
  try {
    const current = readTranslationPreference(userId) ?? {
      version: 1 as const,
      isTranslation: false,
      translatorText: null,
    };
    const next: UploadTranslationPreferenceV1 = {
      version: 1,
      isTranslation: patch.isTranslation ?? current.isTranslation,
      translatorText: Object.hasOwn(patch, "translatorText")
        ? cleanTranslatorText(patch.translatorText ?? null)
        : current.translatorText,
    };
    localStorage.setItem(preferenceKey(userId), JSON.stringify(next));
  } catch {
    // Browser preferences are optional and must never block editing or submission.
  }
}

function preferenceKey(userId: number): string {
  return `viprpg.upload.translation-preference.v1:${userId}`;
}

function cleanTranslatorText(value: string | null): string | null {
  return value?.trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
