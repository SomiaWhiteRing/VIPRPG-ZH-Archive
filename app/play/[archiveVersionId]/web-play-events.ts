const eventName = "viprpg:installed-games-changed";

export function notifyGameResourcesChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(eventName));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(eventName);
    channel.postMessage(null);
    channel.close();
  }
}

export function subscribeGameResourcesChanged(callback: () => void): () => void {
  window.addEventListener(eventName, callback);
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(eventName);
  if (channel) channel.onmessage = callback;
  return () => {
    window.removeEventListener(eventName, callback);
    channel?.close();
  };
}
