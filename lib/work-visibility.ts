import { HttpError } from "@/lib/http";
import { NON_VIPRPG_TAG, tagNameKey } from "@/lib/user-tags";

export const WORK_AUDIENCE_OPTIONS = [
  { value: "public", label: "所有人" },
  { value: "members", label: "登录用户" },
  { value: "maintainers", label: "仅作品维护者" },
] as const;

export type WorkAudience = (typeof WORK_AUDIENCE_OPTIONS)[number]["value"];
export type WorkStatus = "processing" | "published" | "deleted";
export type WorkVisibility = { audience: WorkAudience; showOnHome: boolean };
export type WorkVisibilityInput = { audience?: unknown; showOnHome?: unknown };

// Upgrade already-issued requests/drafts at the boundary; hidden is not a stored lifecycle state.
export function legacyWorkVisibilityInput(input: WorkVisibilityInput & { status?: unknown }): WorkVisibilityInput {
  return input.status === "hidden"
    ? { audience: "maintainers", showOnHome: false }
    : { audience: input.audience, showOnHome: input.showOnHome };
}

export function workStatusFromLegacyInput(value: unknown, fallback: WorkStatus): WorkStatus {
  if (value === undefined || value === "") return fallback;
  if (value === "hidden") return "published";
  if (value === "processing" || value === "published" || value === "deleted") return value;
  throw new HttpError(400, "作品状态不合法");
}

export function hasNonViprpgTag(tags: readonly string[]): boolean {
  return tags.some((tag) => tagNameKey(tag) === tagNameKey(NON_VIPRPG_TAG));
}

export function constrainWorkVisibility(visibility: WorkVisibility, tags: readonly string[]): WorkVisibility {
  return {
    audience: visibility.audience,
    showOnHome: visibility.showOnHome && visibility.audience !== "maintainers" && !hasNonViprpgTag(tags),
  };
}

export function parseWorkVisibility(
  input: WorkVisibilityInput,
  tags: readonly string[],
  fallback: WorkVisibility = { audience: "public", showOnHome: true },
): WorkVisibility {
  const audience = input.audience === undefined ? fallback.audience : input.audience;
  if (!WORK_AUDIENCE_OPTIONS.some((option) => option.value === audience))
    throw new HttpError(400, "作品访问范围不合法。");
  const showOnHome = input.showOnHome === undefined ? fallback.showOnHome : input.showOnHome;
  if (typeof showOnHome !== "boolean") throw new HttpError(400, "首页展示设置不合法。");
  return constrainWorkVisibility({ audience: audience as WorkAudience, showOnHome }, tags);
}

// Missing fields preserve an existing work for older clients and upload drafts.
export function workVisibilityFormInput(form: FormData): WorkVisibilityInput {
  const showOnHome = form.get("show_on_home");
  return legacyWorkVisibilityInput({
    status: form.get("status"),
    audience: form.has("audience") ? form.get("audience") : undefined,
    showOnHome: form.has("show_on_home")
      ? showOnHome === "true" ? true : showOnHome === "false" ? false : showOnHome
      : undefined,
  });
}
