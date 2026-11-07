type NotificationBridge = {
  postMessage: (message: string) => void;
  onmessage: ((event: MessageEvent<string>) => void) | null;
};

let attached: NotificationBridge | undefined;
const pending = new Map<string, (reply: { ok: boolean; value?: unknown }) => void>();

export function androidNotificationBridge() {
  const bridge = (window as Window & { VIPRPGNotifications?: NotificationBridge }).VIPRPGNotifications;
  if (typeof bridge?.postMessage !== "function") return undefined;
  if (attached !== bridge) {
    attached = bridge;
    bridge.onmessage = ({ data }) => {
      let reply: { id: string; ok: boolean; value?: unknown };
      try { reply = JSON.parse(data); } catch { return; }
      pending.get(reply.id)?.(reply);
    };
  }
  return bridge;
}

export function androidNotificationRequest<T>(action: string, values: Record<string, unknown> = {}): Promise<T> {
  const bridge = androidNotificationBridge();
  if (!bridge) return Promise.reject(new Error("Android notification bridge unavailable"));
  return new Promise<T>((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Android notification request timed out"));
    }, 120_000);
    pending.set(id, reply => {
      pending.delete(id);
      clearTimeout(timer);
      if (reply.ok) resolve(reply.value as T);
      else reject(new Error("Android notification request failed"));
    });
    try { bridge.postMessage(JSON.stringify({ ...values, action, id })); }
    catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
  });
}
