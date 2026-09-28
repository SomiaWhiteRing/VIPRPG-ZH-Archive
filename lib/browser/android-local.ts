type Reply = { id: string; ok: boolean; value?: unknown; error?: string };
type Transport = { postMessage: (message: string) => void; onmessage?: (event: MessageEvent<string>) => void };
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let attached: Transport | undefined;
export function localRequest<T>(action: string, values: Record<string, unknown> = {}): Promise<T> {
  const bridge = (window as Window & { VIPRPGLocal?: Transport }).VIPRPGLocal;
  if (!bridge) return Promise.reject(new Error("本地游戏接口不可用，请更新客户端。"));
  if (bridge !== attached) {
    attached = bridge;
    bridge.onmessage = ({ data }) => {
      let reply: Reply;
      try { reply = JSON.parse(data) as Reply; } catch { return; }
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id); clearTimeout(request.timer);
      if (reply.ok) request.resolve(reply.value); else request.reject(new Error(reply.error || "本地文件操作失败。"));
    };
  }
  return new Promise<T>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("本地操作超时，请重试。")); }, 120_000);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    try { bridge.postMessage(JSON.stringify({ ...values, id, action })); }
    catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
  });
}
export type NativePlayerResources = {
  url: string;
  files: { filename: string; start: number; end: number }[];
  saves: Record<string, string>;
};
