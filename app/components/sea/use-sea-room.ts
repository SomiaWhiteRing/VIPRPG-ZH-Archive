import { useCallback, useEffect, useRef, useState } from "react";
import { SEA_ROOM_LIMIT, type SeaEvent, type SeaWindow } from "@/lib/dto/sea";
import { requestJson } from "@/lib/ui/api-response";
import { translate } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM, type UiLocale } from "@/lib/i18n/locale";
import { loadSeaFont } from "./font";

export function useSeaRoom(initial: SeaWindow, locale: UiLocale) {
  const [window, setWindow] = useState(initial);
  const current = useRef(initial);
  const apply = useCallback(async (next: SeaWindow) => {
    const previous = current.current;
    if (next.revision < previous.revision || next.font.expiresAt < previous.font.expiresAt) return;
    const target = { revision: next.revision, font: next.font, messages: next.messages.slice(-SEA_ROOM_LIMIT) };
    current.current = target;
    try {
      await loadSeaFont(next.font);
    } catch (error) {
      if (current.current === target) current.current = previous;
      throw error;
    }
    if (current.current === target) setWindow(target);
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    await apply(await requestJson<SeaWindow>(`/api/sea/messages?${UI_LOCALE_PARAM}=${locale}`, { signal, cache: "no-store" }, translate(locale, "sea.sync")));
  }, [apply, locale]);

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
    function finishSync() {
      initializing = false;
      const pending = buffered;
      buffered = [];
      for (const item of pending.sort((a, b) => a.revision - b.revision)) receive(item);
    }
    function resync() {
      if (syncing || !active) return;
      syncing = true;
      initializing = true;
      const connection = socket;
      void refresh(controller.signal).then(() => {
        if (!active || connection !== socket) return;
        syncing = false;
        finishSync();
      }).catch(() => { if (connection === socket) { syncing = false; connection?.close(); } });
    }
    function receive(event: SeaEvent) {
      receivedAt = Date.now();
      if (syncing || (initializing && event.type === "message")) {
        if (buffered.length >= SEA_ROOM_LIMIT) { buffered = []; socket?.close(); return; }
        buffered.push(event);
        return;
      }
      if (event.type === "snapshot") { resync(); return; }
      const previous = current.current;
      if (event.type === "sync") {
        if (event.revision === previous.revision && event.fontId === previous.font.id) finishSync();
        else resync();
        return;
      }
      if (event.revision <= previous.revision) return;
      if (event.revision !== previous.revision + 1) { resync(); return; }
      const messages = [...previous.messages.filter(message => message.id !== event.message.id), event.message].sort((a, b) => a.id - b.id);
      void apply({ revision: event.revision, font: previous.font, messages }).catch(() => { socket?.close(); });
    }
    function connect() {
      if (!active) return;
      initializing = true;
      syncing = false;
      buffered = [];
      const url = new URL("/api/sea/socket", location.href);
      url.searchParams.set("sync", "1");
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const connection = new WebSocket(url);
      socket = connection;
      bootstrap = setTimeout(() => connection.close(), 15000);
      connection.onmessage = event => {
        if (!active || socket !== connection) return;
        if (event.data === "pong") { receivedAt = Date.now(); return; }
        try {
          const value = JSON.parse(String(event.data)) as SeaEvent;
          if (!Number.isSafeInteger(value.revision) || !["snapshot", "sync", "message"].includes(value.type)) return;
          if (value.type !== "message") { clearTimeout(bootstrap); attempt = 0; }
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
  return { messages: window.messages, font: window.font, refresh };
}
