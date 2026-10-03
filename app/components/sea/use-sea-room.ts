import { useCallback, useEffect, useRef, useState } from "react";
import { SEA_ROOM_LIMIT, type SeaEvent, type SeaWindow } from "@/lib/dto/sea";
import { requestJson } from "@/lib/ui/api-response";

export function useSeaRoom(initial: SeaWindow) {
  const [window, setWindow] = useState(initial);
  const current = useRef(initial);
  const apply = useCallback((next: SeaWindow) => {
    if (next.revision < current.current.revision) return;
    current.current = { revision: next.revision, messages: next.messages.slice(-SEA_ROOM_LIMIT) };
    setWindow(current.current);
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    apply(await requestJson<SeaWindow>("/api/sea/messages", { signal, cache: "no-store" }, "同步对话失败"));
  }, [apply]);

  useEffect(() => {
    let active = true;
    let attempt = 0;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let bootstrap: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    let buffered: SeaEvent[] = [];
    let initializing = true;
    let receivedAt = Date.now();
    let syncing = false;
    const controller = new AbortController();
    function resync() {
      if (syncing || !active) return;
      syncing = true;
      void refresh(controller.signal).catch(() => { socket?.close(); }).finally(() => { syncing = false; });
    }
    function receive(event: SeaEvent) {
      receivedAt = Date.now();
      if (event.type === "snapshot") {
        initializing = false;
        apply(event);
        const pending = buffered;
        buffered = [];
        for (const item of pending.sort((a, b) => a.revision - b.revision)) receive(item);
        return;
      }
      if (initializing) {
        if (buffered.length >= SEA_ROOM_LIMIT) { buffered = []; socket?.close(); return; }
        buffered.push(event);
        return;
      }
      const previous = current.current;
      if (event.revision <= previous.revision) return;
      if (event.revision !== previous.revision + 1) { resync(); return; }
      const messages = [...previous.messages.filter(message => message.id !== event.message.id), event.message].sort((a, b) => a.id - b.id);
      apply({ revision: event.revision, messages });
    }
    function connect() {
      if (!active) return;
      initializing = true;
      buffered = [];
      const url = new URL("/api/sea/socket", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const connection = new WebSocket(url);
      socket = connection;
      bootstrap = setTimeout(() => connection.close(), 15000);
      connection.onmessage = event => {
        if (!active || socket !== connection) return;
        if (event.data === "pong") { receivedAt = Date.now(); return; }
        try {
          const value = JSON.parse(String(event.data)) as SeaEvent;
          if (!Number.isSafeInteger(value.revision) || (value.type !== "snapshot" && value.type !== "message")) return;
          if (value.type === "snapshot") { clearTimeout(bootstrap); attempt = 0; }
          receive(value);
        } catch { connection.close(); }
      };
      connection.onerror = () => connection.close();
      connection.onclose = () => {
        clearTimeout(bootstrap);
        if (active) reconnect = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.random() * 500);
      };
    }
    connect();
    const heartbeat = setInterval(() => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - receivedAt > 70000) socket.close();
      else socket.send("ping");
    }, 25000);
    const resume = () => { if (document.visibilityState === "visible") resync(); };
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(reconnect);
      clearTimeout(bootstrap);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", resume);
      socket?.close();
    };
  }, [apply, refresh]);
  return { messages: window.messages, refresh };
}
