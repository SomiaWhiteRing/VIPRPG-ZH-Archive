import type { ToolArtifact } from "./resources";

export const MAX_DOWNLOAD_FILENAME_TEMPLATE_LENGTH = 180;

function unsafeCharacter(character: string) {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127 || /[<>:"/\\|?*]/.test(character);
}

export function downloadFilenameTemplateError(value: string): string | null {
  if (value.length > MAX_DOWNLOAD_FILENAME_TEMPLATE_LENGTH)
    return "下载文件名模板最多 180 个字符";
  const template = value.trim();
  if (!template) return null;
  if (template.replaceAll("${version}", "").includes("${"))
    return "模板仅支持 ${version}，请检查变量名称和括号";
  if (Array.from(template).some(unsafeCharacter))
    return '文件名不能包含控制字符或 < > : " / \\ | ? *';
  if (/\.(zip|exe|apk)$/i.test(template))
    return "模板无需填写扩展名，下载时会自动添加安装包的扩展名";
  if (template.startsWith(".") || template.endsWith("."))
    return "文件名模板不能以句点开头或结尾";
  return null;
}

export function resourceDownloadFilename(
  template: string,
  artifact: Pick<ToolArtifact, "filename" | "format">,
  version: string,
): string {
  if (!template.trim()) return artifact.filename;
  // Substitute text only; version labels may contain characters unsafe in filenames.
  const expanded = template.trim().replaceAll("${version}", () => version);
  const encoder = new TextEncoder();
  const wellFormed = new TextDecoder().decode(encoder.encode(expanded));
  let stem = Array.from(wellFormed, (character) => unsafeCharacter(character) ? "_" : character)
    .join("").trim().replace(/^\.+/, "_").replace(/[ .]+$/, "");
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  const extension = `.${artifact.format}`;
  let shortened = "", bytes = extension.length;
  // Keep the extension intact and fit both Windows and UTF-8 filesystem limits.
  for (const character of stem) {
    const size = encoder.encode(character).length;
    if (shortened.length + character.length + extension.length > 180 || bytes + size > 240) break;
    shortened += character;
    bytes += size;
  }
  return `${shortened.replace(/[ .]+$/, "") || "download"}${extension}`;
}
