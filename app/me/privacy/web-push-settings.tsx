import { useEffect, useId, useState } from "react";
import { Switch } from "radix-ui";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Label } from "@/app/components/ui/label";
import { useClientEnvironment } from "@/app/components/use-client-environment";
import { requestJson } from "@/lib/ui/api-response";
import { availablePushCategories, PUSH_CATEGORIES, type PushCategory } from "@/lib/push";
import type { AccountPreferences } from "@/lib/account-preferences";

export function WebPushSettings({ publicKey, preferences, onBusyChange }: {
  publicKey: string | null;
  preferences: AccountPreferences;
  onBusyChange: (busy: boolean) => void;
}) {
  const environment = useClientEnvironment();
  const id = useId();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [selected, setSelected] = useState<PushCategory[]>(PUSH_CATEGORIES.map(item => item.value));
  const available = availablePushCategories(preferences);
  const categories = PUSH_CATEGORIES.map(item => item.value).filter(category => available.includes(category) && selected.includes(category));

  useEffect(() => {
    if (!publicKey || environment !== "browser" || !window.isSecureContext
      || !("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    onBusyChange(true);
    async function load() {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const current = await registration?.pushManager.getSubscription() ?? null;
      const saved = current ? await requestJson<{ ok: true; categories: PushCategory[] | null }>("/api/push/subscription", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: current.endpoint }),
      }) : null;
      if (cancelled) return;
      setSubscription(current);
      setPermission(Notification.permission);
      setEnabled(saved?.categories != null && Notification.permission === "granted");
      if (saved?.categories) setSelected(saved.categories);
      setReady(true);
    }
    void load().catch(error => {
      if (!cancelled) console.error("Web Push settings load failed", error);
    }).finally(() => { if (!cancelled) onBusyChange(false); });
    return () => { cancelled = true; onBusyChange(false); };
  }, [environment, publicKey, onBusyChange]);

  async function toggle(checked: boolean) {
    if (busy || !publicKey) return;
    if (!checked) { setEnabled(false); return; }
    setBusy(true);
    onBusyChange(true);
    try {
      const granted = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted") return;
      const registration = await navigator.serviceWorker.register("/notification-sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription()
        ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
      setSubscription(current);
      setEnabled(true);
    } catch (error) { console.error("Web Push subscription failed", error); }
    finally { setBusy(false); onBusyChange(false); }
  }

  if (!publicKey || !ready) return null;
  return <div className="mb-3">
    <input name="webPush" type="hidden" value={JSON.stringify({ enabled, endpoint: subscription?.endpoint ?? null,
      subscription: enabled ? subscription?.toJSON() : null, categories })} />
    <div className="flex min-h-10 items-center gap-3">
      <Label htmlFor={id}>系统通知</Label>
      <Switch.Root id={id} checked={enabled} disabled={busy || permission === "denied"}
        onCheckedChange={checked => void toggle(checked)} aria-controls={`${id}-types`}
        className="relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full bg-muted transition-colors data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Switch.Thumb className="block size-4 translate-x-1 rounded-full bg-background transition-transform data-[state=checked]:translate-x-5" />
      </Switch.Root>
    </div>
    <fieldset id={`${id}-types`} hidden={!enabled} disabled={!enabled || busy} className="mt-1">
      <legend className="sr-only">系统通知类型</legend>
      <div className="flex flex-wrap gap-2">
        {PUSH_CATEGORIES.map(item => <Label key={item.value} htmlFor={`${id}-${item.value}`}
          className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/10 has-disabled:cursor-not-allowed has-disabled:opacity-50">
          <Checkbox id={`${id}-${item.value}`} checked={categories.includes(item.value)} disabled={!available.includes(item.value)}
            onCheckedChange={checked => setSelected(current => checked === true ? [...current, item.value] : current.filter(category => category !== item.value))} />
          {item.label}
        </Label>)}
      </div>
    </fieldset>
  </div>;
}
