import { useEffect } from "react";

export function useMessageRoom(peerId: number, refresh: () => Promise<void>) {
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    let receivedAt = Date.now();
    const mobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const active = () => !disposed && document.visibilityState === "visible" && (!mobile || document.hasFocus());
    function disconnect() {
      clearTimeout(reconnect);
      clearInterval(heartbeat);
      const previous = socket;
      socket = undefined;
      previous?.close();
    }
    function sync(connection: WebSocket | undefined) {
      void refresh().then(() => { attempts = 0; }, () => connection?.close());
    }
    function connect() {
      if (!active() || socket) return;
      const url = new URL(`/api/messages/${peerId}/socket`, location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const connection = new WebSocket(url);
      socket = connection;
      receivedAt = Date.now();
      connection.onopen = () => {
        receivedAt = Date.now();
        sync(connection);
      };
      connection.onmessage = event => {
        receivedAt = Date.now();
        if (event.data === '{"type":"changed"}') sync(connection);
      };
      connection.onerror = () => connection.close();
      connection.onclose = () => {
        if (socket !== connection) return;
        socket = undefined;
        clearInterval(heartbeat);
        if (active()) reconnect = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) + Math.random() * 500);
      };
      // Browser timer only. MessageRoom answers ping without waking JavaScript.
      heartbeat = setInterval(() => {
        if (Date.now() - receivedAt > 70000) connection.close();
        else if (connection.readyState === WebSocket.OPEN) connection.send("ping");
      }, 25000);
    }
    function update() {
      if (active()) { connect(); sync(socket); }
      else disconnect();
    }
    connect();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    window.addEventListener("pageshow", update);
    window.addEventListener("pagehide", disconnect);
    return () => {
      disposed = true;
      disconnect();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("pageshow", update);
      window.removeEventListener("pagehide", disconnect);
    };
  }, [peerId, refresh]);
}
