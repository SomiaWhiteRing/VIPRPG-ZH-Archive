(() => {
  "use strict";

  const FETCH_IMAGE_MESSAGE = "viprpg-material-cropper:fetch-image";
  const MATERIAL_IMAGE_SELECTOR = "#wikibody img.atwiki_plugin_ref";
  const ACTIVE_IMAGE_CLASS = "viprpg-material-cropper-active";

  const SHEET_TYPES = new Map([
    [
      "288x256",
      {
        kind: "sprite",
        label: "精灵",
        sheetWidth: 288,
        sheetHeight: 256,
        cellWidth: 24,
        cellHeight: 32,
      },
    ],
    [
      "192x192",
      {
        kind: "face",
        label: "脸图",
        sheetWidth: 192,
        sheetHeight: 192,
        cellWidth: 48,
        cellHeight: 48,
      },
    ],
  ]);

  const controlPanel = document.createElement("aside");
  controlPanel.id = "viprpg-material-cropper-panel";
  controlPanel.setAttribute("aria-label", "素材裁切测试");

  const panelTitle = document.createElement("strong");
  panelTitle.id = "viprpg-material-cropper-panel-title";
  panelTitle.textContent = "素材裁切测试";

  const enabledLabel = document.createElement("label");
  enabledLabel.className = "viprpg-material-cropper-toggle";
  const enabledInput = document.createElement("input");
  enabledInput.type = "checkbox";
  enabledInput.checked = true;
  enabledInput.setAttribute("role", "switch");
  const enabledText = document.createElement("span");
  enabledText.textContent = "启用裁切";
  enabledLabel.append(enabledInput, enabledText);

  const actionFieldset = document.createElement("fieldset");
  actionFieldset.id = "viprpg-material-cropper-actions";
  const actionLegend = document.createElement("legend");
  actionLegend.textContent = "单击后";
  const actionOptions = document.createElement("div");
  actionOptions.className = "viprpg-material-cropper-action-options";

  for (const [value, label] of [
    ["copy", "复制"],
    ["download", "下载"],
  ]) {
    const optionLabel = document.createElement("label");
    const optionInput = document.createElement("input");
    optionInput.type = "radio";
    optionInput.name = "viprpg-material-cropper-action";
    optionInput.value = value;
    optionInput.checked = value === "download";
    optionLabel.append(optionInput, document.createTextNode(label));
    actionOptions.append(optionLabel);
  }

  actionFieldset.append(actionLegend, actionOptions);
  controlPanel.append(panelTitle, enabledLabel, actionFieldset);
  document.documentElement.append(controlPanel);

  const selectionOverlay = document.createElement("div");
  selectionOverlay.id = "viprpg-material-cropper-selection";
  selectionOverlay.hidden = true;
  selectionOverlay.setAttribute("aria-hidden", "true");
  document.documentElement.append(selectionOverlay);

  const toast = document.createElement("div");
  toast.id = "viprpg-material-cropper-toast";
  toast.hidden = true;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.documentElement.append(toast);

  let activeImage = null;
  let toastTimer = null;
  let featureEnabled = true;
  let clickAction = "download";
  let operationInProgress = false;

  enabledInput.addEventListener("change", () => {
    featureEnabled = enabledInput.checked;
    actionFieldset.disabled = !featureEnabled;
    if (!featureEnabled) {
      hideSelection();
    }
  });

  actionOptions.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement) {
      clickAction = event.target.value;
    }
  });

  document.addEventListener("pointermove", handlePointerMove, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("pointerleave", hideSelection, true);
  window.addEventListener("scroll", hideSelection, { capture: true, passive: true });
  window.addEventListener("resize", hideSelection, { passive: true });

  function handlePointerMove(event) {
    if (!featureEnabled) {
      return;
    }

    const selection = selectionFromEvent(event);
    if (!selection) {
      hideSelection();
      return;
    }

    if (activeImage !== selection.image) {
      activeImage?.classList.remove(ACTIVE_IMAGE_CLASS);
      activeImage = selection.image;
      activeImage.classList.add(ACTIVE_IMAGE_CLASS);
    }

    const { displayRect } = selection;
    selectionOverlay.style.left = `${displayRect.left}px`;
    selectionOverlay.style.top = `${displayRect.top}px`;
    selectionOverlay.style.width = `${displayRect.width}px`;
    selectionOverlay.style.height = `${displayRect.height}px`;
    selectionOverlay.dataset.kind = selection.spec.kind;
    selectionOverlay.hidden = false;
  }

  async function handleClick(event) {
    if (!featureEnabled || event.button !== 0) {
      return;
    }

    const selection = selectionFromEvent(event);
    if (!selection) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (operationInProgress) {
      showToast("正在处理上一张素材。", "neutral");
      return;
    }

    const requestedAction = clickAction;
    operationInProgress = true;
    showToast(`正在裁切${selection.spec.label}…`, "neutral");

    try {
      const { dataUrl } = await requestImage(selection.image.currentSrc || selection.image.src);
      const sourceImage = await loadImage(dataUrl);
      const blob = await cropSelection(sourceImage, selection);

      if (requestedAction === "copy") {
        await copyPngToClipboard(blob);
        showToast(`已复制 ${selection.spec.cellWidth}×${selection.spec.cellHeight} PNG`, "success");
      } else {
        const filename = buildFilename(selection);
        triggerDownload(blob, filename);
        showToast(`已下载 ${filename}`, "success");
      }
    } catch (error) {
      console.error("[VIPRPG 素材裁切器]", error);
      const message =
        error?.name === "ClipboardWriteError"
          ? "复制失败：请检查扩展的剪贴板权限后重试。"
          : `${requestedAction === "copy" ? "复制" : "下载"}失败：无法处理这张图片，请刷新页面后重试。`;
      showToast(message, "error");
    } finally {
      operationInProgress = false;
    }
  }

  function selectionFromEvent(event) {
    const image = event.target?.closest?.(MATERIAL_IMAGE_SELECTOR);
    if (!(image instanceof HTMLImageElement)) {
      return null;
    }

    const sourceUrl = new URL(image.currentSrc || image.src);
    if (
      sourceUrl.protocol !== "https:" ||
      sourceUrl.hostname !== "img.atwiki.jp" ||
      !sourceUrl.pathname.startsWith("/viprpg_sozai/attach/")
    ) {
      return null;
    }

    const spec = SHEET_TYPES.get(`${image.naturalWidth}x${image.naturalHeight}`);
    if (!spec) {
      return null;
    }

    const imageRect = image.getBoundingClientRect();
    if (imageRect.width <= 0 || imageRect.height <= 0) {
      return null;
    }

    const offsetX = event.clientX - imageRect.left;
    const offsetY = event.clientY - imageRect.top;
    if (
      offsetX < 0 ||
      offsetY < 0 ||
      offsetX >= imageRect.width ||
      offsetY >= imageRect.height
    ) {
      return null;
    }

    const sourceX = (offsetX / imageRect.width) * spec.sheetWidth;
    const sourceY = (offsetY / imageRect.height) * spec.sheetHeight;
    const column = Math.floor(sourceX / spec.cellWidth);
    const row = Math.floor(sourceY / spec.cellHeight);
    const displayCellWidth = (spec.cellWidth / spec.sheetWidth) * imageRect.width;
    const displayCellHeight = (spec.cellHeight / spec.sheetHeight) * imageRect.height;

    return {
      image,
      spec,
      column,
      row,
      sourceX: column * spec.cellWidth,
      sourceY: row * spec.cellHeight,
      displayRect: {
        left: imageRect.left + column * displayCellWidth,
        top: imageRect.top + row * displayCellHeight,
        width: displayCellWidth,
        height: displayCellHeight,
      },
    };
  }

  function hideSelection() {
    selectionOverlay.hidden = true;
    activeImage?.classList.remove(ACTIVE_IMAGE_CLASS);
    activeImage = null;
  }

  function requestImage(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: FETCH_IMAGE_MESSAGE, url }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok || typeof response.dataUrl !== "string") {
          reject(new Error(response?.error || "无法读取图片。"));
          return;
        }

        resolve(response);
      });
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener("error", () => reject(new Error("图片解码失败。")), {
        once: true,
      });
      image.src = dataUrl;
    });
  }

  async function cropSelection(sourceImage, selection) {
    const { spec } = selection;
    if (
      sourceImage.naturalWidth !== spec.sheetWidth ||
      sourceImage.naturalHeight !== spec.sheetHeight
    ) {
      throw new Error("图片尺寸在读取期间发生变化。");
    }

    const canvas = document.createElement("canvas");
    canvas.width = spec.cellWidth;
    canvas.height = spec.cellHeight;

    const context = canvas.getContext("2d", { willReadFrequently: spec.kind === "sprite" });
    if (!context) {
      throw new Error("浏览器无法创建裁切画布。");
    }

    context.imageSmoothingEnabled = false;
    context.drawImage(
      sourceImage,
      selection.sourceX,
      selection.sourceY,
      spec.cellWidth,
      spec.cellHeight,
      0,
      0,
      spec.cellWidth,
      spec.cellHeight,
    );

    if (spec.kind === "sprite") {
      removeSpriteBackground(context, sourceImage, spec);
    }

    return canvasToPng(canvas);
  }

  function removeSpriteBackground(context, sourceImage, spec) {
    const keyCanvas = document.createElement("canvas");
    keyCanvas.width = 1;
    keyCanvas.height = 1;
    const keyContext = keyCanvas.getContext("2d", { willReadFrequently: true });
    if (!keyContext) {
      throw new Error("浏览器无法读取背景色。");
    }

    keyContext.imageSmoothingEnabled = false;
    keyContext.drawImage(sourceImage, 0, 0, 1, 1, 0, 0, 1, 1);
    const key = keyContext.getImageData(0, 0, 1, 1).data;
    if (key[3] === 0) {
      return;
    }

    const imageData = context.getImageData(0, 0, spec.cellWidth, spec.cellHeight);
    const pixels = imageData.data;

    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index] === key[0] &&
        pixels[index + 1] === key[1] &&
        pixels[index + 2] === key[2]
      ) {
        pixels[index + 3] = 0;
      }
    }

    context.putImageData(imageData, 0, 0);
  }

  function canvasToPng(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("PNG 生成失败。"));
        }
      }, "image/png");
    });
  }

  function buildFilename(selection) {
    const sourceUrl = new URL(selection.image.currentSrc || selection.image.src);
    const rawName = sourceUrl.pathname.split("/").pop() || "material";
    let decodedName = rawName;

    try {
      decodedName = decodeURIComponent(rawName);
    } catch {
      // Keep the URL-safe name when the attachment contains invalid escapes.
    }

    const extensionIndex = decodedName.lastIndexOf(".");
    const nameWithoutExtension = extensionIndex > 0 ? decodedName.slice(0, extensionIndex) : decodedName;
    const safeName =
      nameWithoutExtension
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/[.\s]+$/g, "")
        .slice(0, 120) || "material";

    return `${safeName}-${selection.spec.kind}-r${selection.row + 1}-c${selection.column + 1}.png`;
  }

  function triggerDownload(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    (document.body || document.documentElement).append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }

  async function copyPngToClipboard(blob) {
    if (!navigator.clipboard?.write || typeof ClipboardItem !== "function") {
      const error = new Error("浏览器不支持复制 PNG。");
      error.name = "ClipboardWriteError";
      throw error;
    }

    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch (cause) {
      const error = new Error("浏览器拒绝写入剪贴板。", { cause });
      error.name = "ClipboardWriteError";
      throw error;
    }
  }

  function showToast(message, tone) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    toastTimer = window.setTimeout(
      () => {
        toast.hidden = true;
      },
      tone === "error" ? 4_000 : 2_200,
    );
  }
})();
