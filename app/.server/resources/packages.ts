import type { AppRuntime } from "@/app/.server/runtime";
import type { ToolArtifact } from "@/lib/resources";
import { HttpError } from "@/lib/http";
import { formatFeedbackError, UiFeedbackError } from "@/lib/i18n/feedback";
import { translate } from "@/lib/i18n/core";
import { readWindyPackage } from "@/lib/windy-package";
import { readAndroidPackage } from "@/lib/android-package";

export async function verifyPackageArtifact(runtime: AppRuntime, row: ToolArtifact) {
  const resource = await runtime.db.prepare("SELECT p.slug FROM resources p JOIN tool_releases r ON r.resource_id=p.id WHERE r.id=?").bind(row.release_id).first<{ slug: string }>();
  const reader = resource?.slug === "windy-translator" ? readWindyPackage
    : resource?.slug === "viprpg-android" ? readAndroidPackage : null;
  if (!reader) return;
  try {
    const info = await reader(row.size_bytes, async (offset, length) => {
      const object = await runtime.bucket.get(row.object_key, { range: { offset, length } });
      if (!object) throw new UiFeedbackError("admin.resources.missingObject");
      return new Uint8Array(await object.arrayBuffer());
    });
    if (row.target !== info.target || row.format !== (info.target === "windows-x64" ? "zip" : "apk") || row.application_build_id !== info.applicationBuildId) throw new UiFeedbackError("admin.package.error.identity");
  } catch (error) {
    throw new HttpError(400, formatFeedbackError(error, runtime.uiLocale, translate(runtime.uiLocale, "admin.package.error.verification")));
  }
}
