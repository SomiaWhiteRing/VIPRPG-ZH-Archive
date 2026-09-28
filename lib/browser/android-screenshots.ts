import { isAndroidClient } from "./client-environment";

type NativeChannel = {
  postMessage: (message: string) => void;
  onmessage: ((event: { data: string }) => void) | null;
};
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Pending>();
let connected: NativeChannel | undefined;

function channel(): NativeChannel {
  const bridge = (window as Window & { VIPRPGScreenshots?: NativeChannel }).VIPRPGScreenshots;
  if (!bridge || typeof bridge.postMessage !== "function") {
    throw new Error("此客户端暂不支持截图保存，请更新 Android 客户端和系统 WebView。");
  }
  if (connected !== bridge) {
    connected = bridge;
    bridge.onmessage = ({ data }) => {
      let response: { id: string; ok: boolean; value?: unknown; error?: string };
      try { response = JSON.parse(data); } catch { return; }
      const request = pending.get(response.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(response.id);
      if (response.ok) request.resolve(response.value);
      else request.reject(new Error(response.error ?? "截图操作失败，请重试。"));
    };
  }
  return bridge;
}

function request<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const bridge = channel();
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(action === "save" ? "未能及时确认写入结果，请先查看截图图库。" : "操作等待超时，请重试。"));
    }, 120_000);
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    try { bridge.postMessage(JSON.stringify({ ...payload, action, id })); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}

export async function saveAndroidScreenshot(blob: Blob, workId: number, title: string, capturedAt: number): Promise<void> {
  if (blob.size > 8 * 1024 * 1024) throw new Error("截图文件超过 8 MiB，无法保存。");
  const png = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(new Error("无法读取截图图像。"));
    reader.readAsDataURL(blob);
  });
  await request("save", { png, workId, title, capturedAt });
}

export function setAndroidOnlinePlaying(playing: boolean, immersive: boolean): void {
  if (!isAndroidClient()) return;
  // Old APKs do not have the new channel; this does not enable old screenshot storage.
  try { void request("playerState", { playing, immersive }).catch(() => {}); } catch { /* No native channel. */ }
}
