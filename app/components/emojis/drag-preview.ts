import type { FaceEmoji } from "@/lib/face-emojis";

export function emojiDragPreview(emoji: FaceEmoji, button: HTMLButtonElement) {
  const image =
    button.querySelector("img") ??
    button.closest("[data-face-sheet]")?.querySelector("img");
  if (emoji.available && (!image?.complete || !image.naturalWidth)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 48;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingEnabled = false;
  if (emoji.available && image) {
    // Copy exactly one source cell; native element snapshots may include the
    // surrounding sheet, selection borders, or the hover remove button.
    context.drawImage(
      image,
      emoji.column * 48,
      emoji.row * 48,
      48,
      48,
      0,
      0,
      48,
      48,
    );
  } else {
    context.fillStyle = "#888";
    context.fillRect(0, 0, 48, 48);
    context.fillStyle = "#fff";
    context.font = "24px sans-serif";
    context.textAlign = "center";
    context.fillText("×", 24, 32);
  }
  canvas.className =
    "fixed -left-[1000px] -top-[1000px] size-12 pointer-events-none [image-rendering:pixelated]";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  return canvas;
}
