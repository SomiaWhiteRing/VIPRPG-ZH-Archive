import { useSyncExternalStore } from "react";
import { Smartphone } from "lucide-react";
import { buttonVariants } from "@/app/components/ui/button";

const subscribe = () => () => {};
const serverOrigin = () => "";
function androidOrigin() {
  return /Android/i.test(navigator.userAgent) &&
    [
      "https://viprpg-zh-archive.q578235562.workers.dev",
      "https://viprpg-zh-archive-staging.q578235562.workers.dev",
    ].includes(window.location.origin)
    ? window.location.origin
    : "";
}

export function KaiImportLink({ archiveVersionId }: { archiveVersionId: number }) {
  const origin = useSyncExternalStore(subscribe, androidOrigin, serverOrigin);
  if (!origin) return null;
  const manifest = `${origin}/api/archive-versions/${archiveVersionId}/kai-import`;
  const fallback = `${origin}/resources#easyrpg-kai`;
  const href = `intent://import?manifest=${encodeURIComponent(manifest)}#Intent;scheme=easyrpg-kai;package=org.easyrpg.player.kai;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  return (
    <div className="grid gap-1.5">
      <a className={`${buttonVariants({ variant: "outline" })} min-h-11 w-full`} href={href}>
        <Smartphone aria-hidden />
        导入 EasyRPG Player Kai
      </a>
      <p className="text-center text-xs text-muted">
        在 Kai 中确认后下载到本地。未打开？
        <a className="underline underline-offset-2" href="/resources#easyrpg-kai">安装或更新 Android 版</a>
      </p>
    </div>
  );
}
