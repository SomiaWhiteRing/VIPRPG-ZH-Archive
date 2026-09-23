import type { AppRuntime } from "@/app/.server/runtime";
import type { ToolArtifact } from "@/lib/resources";
import { HttpError } from "@/lib/http";
import { readWindyPackage } from "@/lib/windy-package";

export async function verifyWindyArtifact(runtime: AppRuntime, row: ToolArtifact) {
  const resource = await runtime.db.prepare("SELECT p.slug FROM resources p JOIN tool_releases r ON r.resource_id=p.id WHERE r.id=?").bind(row.release_id).first<{ slug: string }>();
  if (resource?.slug !== "windy-translator") return;
  try {
    const info = await readWindyPackage(row.size_bytes, async (offset, length) => {
      const object = await runtime.bucket.get(row.object_key, { range: { offset, length } });
      if (!object) throw new Error("文件缺失");
      return new Uint8Array(await object.arrayBuffer());
    });
    if (row.target !== info.target || row.format !== "zip" || row.application_build_id !== info.applicationBuildId) throw new Error("包内身份与登记内容不符");
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "温蒂安装包校验失败");
  }
}
