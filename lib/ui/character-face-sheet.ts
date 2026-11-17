import { sha256Hex } from "@/lib/sha256";
import { UiFeedbackError } from "@/lib/i18n/feedback";
export type InspectedCharacterFaceSheet = {
  sha256: string;
  width: number;
  height: number;
};

const MAX_FACE_SHEET_BYTES = 256 * 1024;
const FACE_CELL_SIZE = 48;
const MAX_FACE_SHEET_WIDTH = 192;

export async function inspectCharacterFaceSheetFile(
  file: File,
): Promise<InspectedCharacterFaceSheet> {
  if (file.type.toLowerCase() !== "image/png") {
    throw new UiFeedbackError("upload.faces.error.png", { kind: "sheet", name: "" });
  }
  if (file.size <= 0 || file.size > MAX_FACE_SHEET_BYTES) {
    throw new UiFeedbackError("upload.faces.error.sourceSize");
  }

  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new UiFeedbackError("upload.faces.error.decode");
  }
  const width = image.width;
  const height = image.height;
  image.close();
  if (
    width < FACE_CELL_SIZE ||
    height < FACE_CELL_SIZE ||
    width > MAX_FACE_SHEET_WIDTH ||
    width % FACE_CELL_SIZE !== 0 ||
    height % FACE_CELL_SIZE !== 0
  ) {
    throw new UiFeedbackError("upload.faces.error.dimensions", { kind: "sheet", name: "" });
  }

  const sha256 = await sha256Hex(await file.arrayBuffer());
  return { sha256, width, height };
}
