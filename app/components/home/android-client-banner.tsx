import type { loader as rootLoader } from "@/app/root";
import { Button } from "@/app/components/ui/button";
import { useClientEnvironment } from "@/app/components/use-client-environment";
import { ChevronRight, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Link, useRouteLoaderData } from "react-router";

const subscribe = () => () => {};
const serverDismissed = () => false;

export function AndroidClientBanner() {
  const environment = useClientEnvironment();
  const session = useRouteLoaderData<typeof rootLoader>("root")?.session;
  const storageKey = session ? `viprpg:android-client-banner-dismissed:${session.id}` : null;
  const [closedUser, setClosedUser] = useState<number | null>(null);
  const dismissed = useSyncExternalStore(subscribe, () => {
    if (!storageKey) return false;
    try { return localStorage.getItem(storageKey) === "1"; }
    catch { return false; }
  }, serverDismissed);
  if (environment !== "browser" || dismissed || (session && closedUser === session.id)) return null;

  return (
    <div className="android-client-banner">
      <Link className="android-client-banner-link" to="/resources#viprpg-android">
        <svg
          className="android-client-banner-phone"
          viewBox="0 0 54 68"
          aria-hidden="true"
        >
          <g transform="rotate(-8 28 33)">
            <rect x="13.5" y="4" width="33" height="61" rx="6" fill="var(--banner-phone)" opacity=".12" />
            <rect x="11.5" y="1" width="33" height="61" rx="6" fill="var(--banner-phone)" />
            <rect x="14" y="4" width="28" height="52" rx="3.5" fill="var(--banner-screen)" />
            <rect x="23" y="4" width="10" height="2.5" rx="1.25" fill="var(--banner-phone)" />
            <image className="android-client-banner-icon" x="15" y="18" width="26" height="26" href="/icon/windI.png" />
            <rect x="24" y="58.5" width="8" height="1.5" rx=".75" fill="var(--banner-phone-detail)" />
          </g>
        </svg>
        <span className="android-client-banner-title">网站安卓客户端</span>
        <ChevronRight className="android-client-banner-arrow" aria-hidden="true" />
      </Link>
      {session ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="android-client-banner-close min-h-0 size-7 p-0 [&_svg]:size-3.5"
          aria-label="关闭网站安卓客户端横幅"
          onClick={() => {
            setClosedUser(session.id);
            try { localStorage.setItem(storageKey!, "1"); }
            catch { /* Keep this visit dismissed when browser storage is unavailable. */ }
          }}
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
