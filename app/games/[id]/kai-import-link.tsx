import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Smartphone } from "lucide-react";
import { buttonVariants } from "@/app/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";

const subscribe = () => () => {};
const serverOrigin = () => "";
function kaiImportOrigin() {
  // Allow desktop browsers on loopback hosts to exercise the launch fallback.
  if (["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
    return window.location.origin;
  }
  return /Android/i.test(navigator.userAgent) &&
    [
      "https://viprpg.org",
      "https://staging.viprpg.org",
    ].includes(window.location.origin)
    ? window.location.origin
    : "";
}

export function KaiImportLink({ archiveVersionId }: { archiveVersionId: number }) {
  const origin = useSyncExternalStore(subscribe, kaiImportOrigin, serverOrigin);
  const [failed, setFailed] = useState(false);
  const [launching, setLaunching] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cancelAttempt = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelAttempt.current?.(), [archiveVersionId]);

  if (!origin) return null;
  const manifest = `${origin}/api/archive-versions/${archiveVersionId}/kai-import`;

  function launchKai() {
    if (cancelAttempt.current) return;
    setFailed(false);
    setLaunching(true);
    const currentUrl = window.location.href;
    const fallback = new URL(currentUrl);
    fallback.hash = "kai-import-failed";
    const href = `intent://import?manifest=${encodeURIComponent(manifest)}#Intent;scheme=easyrpg-kai;package=org.easyrpg.player.kai;S.browser_fallback_url=${encodeURIComponent(fallback.href)};end`;

    // Intent navigation has no success callback. Leaving the page cancels the
    // fallback so returning from Kai does not display a failure dialog.
    const cleanup = () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", cleanup);
      window.removeEventListener("hashchange", onFallback);
      cancelAttempt.current = null;
      setLaunching(false);
    };
    const onFallback = () => {
      if (window.location.href !== fallback.href) return;
      cleanup();
      window.history.replaceState(window.history.state, "", currentUrl);
      setFailed(true);
    };
    const onVisibilityChange = () => {
      if (document.hidden) cleanup();
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      if (!document.hidden) setFailed(true);
    }, 1500);
    cancelAttempt.current = cleanup;
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", cleanup);
    window.addEventListener("hashchange", onFallback);

    try {
      window.location.assign(href);
    } catch {
      cleanup();
      setFailed(true);
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${buttonVariants({ variant: "outline" })} min-h-11 w-full`}
        onClick={launchKai}
        disabled={launching}
        aria-busy={launching}
      >
        <Smartphone aria-hidden />
        导入 EasyRPG Player Kai
      </button>
      <AlertDialog open={failed} onOpenChange={setFailed}>
        <AlertDialogContent onCloseAutoFocus={(event) => {
          event.preventDefault();
          buttonRef.current?.focus();
        }}>
          <AlertDialogTitle className="text-lg font-bold">未能打开 EasyRPG Player Kai</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted">
            如果EasyRPG没有打开，请通过右上角菜单选择“在浏览器中打开”后重试，或下载并安装最新版EasyRPG Player Kai。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel className={buttonVariants({ variant: "outline" })}>关闭</AlertDialogCancel>
            <a className={buttonVariants()} href="/resources#easyrpg-kai">下载最新版</a>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
