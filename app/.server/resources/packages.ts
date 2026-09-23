import type { AppRuntime } from "@/app/.server/runtime";
import type { ToolArtifact } from "@/lib/resources";
import { HttpError } from "@/lib/http";
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
      if (!object) throw new Error("文件缺失");
      return new Uint8Array(await object.arrayBuffer());
    });
    if (row.target !== info.target || row.format !== (info.target === "windows-x64" ? "zip" : "apk") || row.application_build_id !== info.applicationBuildId) throw new Error("包内身份与登记内容不符");
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "安装包校验失败");
  }
}
