import { useEffect, useId, useRef, useState } from "react";
import { Settings2, X } from "lucide-react";
import { Switch } from "radix-ui";
import * as Dialog from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { InfoTooltip } from "@/app/components/ui/info-tooltip";
import { Label } from "@/app/components/ui/label";
import { useClientEnvironment } from "@/app/components/use-client-environment";
import { requestJson } from "@/lib/ui/api-response";
import { availablePushCategories, PUSH_CATEGORIES, type PushCategory } from "@/lib/push";
import type { AccountPreferences } from "@/lib/account-preferences";
import { WebPushPermissionGuide, type PushPermissionGuide } from "./web-push-permission-guide";

export function WebPushSettings({ publicKey, preferences }: {
  publicKey: string | null;
  preferences: AccountPreferences;
}) {
  const environment = useClientEnvironment();
  const id = useId();
  const settingsButton = useRef<HTMLButtonElement>(null);
  const [client, setClient] = useState<{ supported: boolean; guide: PushPermissionGuide } | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [selected, setSelected] = useState<PushCategory[]>(PUSH_CATEGORIES.map(item => item.value));
  const [draft, setDraft] = useState(selected);
  const [open, setOpen] = useState(false);
  const available = availablePushCategories(preferences);
  const blocked = client !== null && (!client.supported || permission === "denied");

  useEffect(() => {
    if (!publicKey || environment !== "browser") return;
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const homeScreen = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const android = /Android/.test(ua);
    const guide: PushPermissionGuide = ios ? homeScreen ? "ios-settings" : "ios"
      : /Firefox\//.test(ua) ? android ? "firefox-android" : "firefox-desktop"
        : /Chrome\//.test(ua) && !/Edg|OPR|SamsungBrowser/.test(ua) ? android ? "chrome-android" : "chrome-desktop" : "other";
    const supported = (!ios || homeScreen) && window.isSecureContext
      && "Notification" in window && "PushManager" in window && "serviceWorker" in navigator;
    setClient({ supported, guide });
    if (!supported) { setReady(true); return; }
    let cancelled = false;
    let status: PermissionStatus | undefined;
    function syncPermission() {
      setPermission(Notification.permission);
      if (Notification.permission !== "granted") setEnabled(false);
    }
    function onVisibilityChange() { if (document.visibilityState === "visible") syncPermission(); }
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", onVisibilityChange);
    if ("permissions" in navigator) void navigator.permissions.query({ name: "notifications" }).then(value => {
      if (cancelled) return;
      status = value;
      status.addEventListener("change", syncPermission);
    }).catch(() => { /* Focus and visibility changes also refresh permission. */ });
    async function load() {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const current = await registration?.pushManager.getSubscription() ?? null;
      const saved = current ? await requestJson<{ ok: true; categories: PushCategory[] | null }>("/api/push/subscription", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: current.endpoint }),
      }) : null;
      if (cancelled) return;
      setSubscription(current);
      syncPermission();
      setEnabled(saved?.categories != null && Notification.permission === "granted");
      if (saved?.categories) setSelected(saved.categories);
      setReady(true);
    }
    void load().catch(error => { if (!cancelled) console.error("Web Push settings load failed", error); });
    return () => {
      cancelled = true;
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      status?.removeEventListener("change", syncPermission);
    };
  }, [environment, publicKey]);

  async function save(checked: boolean, current: PushSubscription | null, categories: PushCategory[]) {
    return requestJson<{ ok: true; categories: PushCategory[] | null }>("/api/push/subscription", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: checked, endpoint: current?.endpoint ?? null,
        subscription: checked ? current?.toJSON() : null, categories }),
    });
  }

  async function toggle(checked: boolean) {
    if (busy || !publicKey || blocked) return;
    setBusy(true);
    try {
      let current = subscription;
      if (checked) {
        const granted = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        setPermission(granted);
        if (granted !== "granted") return;
        const registration = await navigator.serviceWorker.register("/notification-sw.js", { scope: "/", updateViaCache: "none" });
        await navigator.serviceWorker.ready;
        current = await registration.pushManager.getSubscription()
          ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
      }
      const saved = await save(checked, current, selected);
      setSubscription(current);
      if (saved.categories) setSelected(saved.categories);
      setEnabled(checked);
    } catch (error) { console.error("Web Push subscription failed", error); }
    finally { setBusy(false); }
  }

  async function saveCategories() {
    if (busy || !enabled || blocked) return;
    setBusy(true);
    try {
      const saved = await save(true, subscription, draft);
      if (saved.categories) setSelected(saved.categories);
      setOpen(false);
    } catch (error) { console.error("Web Push settings save failed", error); }
    finally { setBusy(false); }
  }

  if (!publicKey || !ready || !client || environment !== "browser") return null;
  return <div className="flex shrink-0 items-center gap-2">
    <Label htmlFor={id} className="whitespace-nowrap text-sm">系统通知</Label>
    <Switch.Root id={id} checked={enabled} disabled={busy || blocked} onCheckedChange={checked => void toggle(checked)}
      className="relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full bg-muted transition-colors data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
      <Switch.Thumb className="block size-4 translate-x-1 rounded-full bg-background transition-transform data-[state=checked]:translate-x-5" />
    </Switch.Root>
    {blocked ? <InfoTooltip label="查看通知开启引导" className="w-[min(21rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] p-3">
      <WebPushPermissionGuide guide={client.guide} supported={client.supported} />
    </InfoTooltip> : <Button ref={settingsButton} type="button" variant="ghost" size="icon" className="size-9" disabled={busy}
      aria-label="系统通知接收类型" aria-haspopup="dialog" onClick={() => { setDraft(selected); setOpen(true); }}>
      <Settings2 aria-hidden />
    </Button>}
    <Dialog.Root open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <Dialog.Portal><Dialog.Overlay />
        <Dialog.Content className="left-1/2 top-1/2 grid max-h-[calc(100dvh-2rem)] w-[min(27rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg p-5"
          onCloseAutoFocus={event => { event.preventDefault(); (settingsButton.current ?? document.getElementById(id))?.focus(); }}>
          <div className="flex items-start justify-between gap-3"><div>
            <Dialog.Title id={`${id}-title`}>接收类型</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted">设置仅影响当前浏览器。</Dialog.Description>
          </div><Button type="button" variant="ghost" size="icon" className="size-9" disabled={busy} aria-label="关闭设置" onClick={() => setOpen(false)}><X aria-hidden /></Button></div>
          <form onSubmit={event => { event.preventDefault(); void saveCategories(); }}>
            <fieldset aria-labelledby={`${id}-title`} disabled={!enabled || blocked || busy} className="mb-5 grid disabled:opacity-50">
              {PUSH_CATEGORIES.map(item => <Label key={item.value} htmlFor={`${id}-${item.value}`}
                className="flex min-h-11 cursor-pointer items-center gap-3 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-50">
                <Checkbox id={`${id}-${item.value}`} checked={available.includes(item.value) && draft.includes(item.value)} disabled={!available.includes(item.value)}
                  onCheckedChange={checked => setDraft(current => checked === true ? [...current, item.value] : current.filter(category => category !== item.value))} />
                {item.label}
              </Label>)}
            </fieldset>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>取消</Button>
              <Button type="submit" disabled={!enabled || blocked || busy}>保存设置</Button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
