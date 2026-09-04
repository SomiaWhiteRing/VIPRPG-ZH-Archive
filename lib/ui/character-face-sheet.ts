export type InspectedCharacterFaceSheet = {
  sha256: string;
  width: number;
  height: number;
};

const MAX_FACE_SHEET_BYTES = 256 * 1024;
const FACE_CELL_SIZE = 48;
const MAX_FACE_SHEET_SIZE = 192;

export async function inspectCharacterFaceSheetFile(
  file: File,
): Promise<InspectedCharacterFaceSheet> {
  if (file.type.toLowerCase() !== "image/png") {
    throw new Error("脸图素材表只支持 PNG 文件。");
  }
  if (file.size <= 0 || file.size > MAX_FACE_SHEET_BYTES) {
    throw new Error("脸图素材表不能超过 256 KiB。");
  }

  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error("无法读取脸图素材表，请选择有效的 PNG 文件。");
  }
  const width = image.width;
  const height = image.height;
  image.close();
  if (
    width < FACE_CELL_SIZE ||
    height < FACE_CELL_SIZE ||
    width > MAX_FACE_SHEET_SIZE ||
    height > MAX_FACE_SHEET_SIZE ||
    width % FACE_CELL_SIZE !== 0 ||
    height % FACE_CELL_SIZE !== 0
  ) {
    throw new Error(
      "脸图素材表尺寸必须在 48×48 至 192×192 之间，且宽高均为 48 的倍数。",
    );
  }

  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return { sha256, width, height };
}
