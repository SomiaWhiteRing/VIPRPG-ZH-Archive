import { sha256Hex } from "@/lib/sha256";

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const sha256 = await sha256Hex(await event.data.arrayBuffer());
    self.postMessage({
      sha256,
    });
  } catch {
    self.postMessage({ error: "无法计算文件校验值，请重新选择文件" });
  }
};
export {};
