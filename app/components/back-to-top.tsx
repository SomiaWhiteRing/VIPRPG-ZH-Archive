import { ArrowUp } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "./ui/button";

function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  window.addEventListener("resize", onChange);
  return () => {
    window.removeEventListener("scroll", onChange);
    window.removeEventListener("resize", onChange);
  };
}

const getSnapshot = () => window.scrollY > window.innerHeight;
const getServerSnapshot = () => false;

export function BackToTop() {
  const visible = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <Button
      type="button"
      size="icon"
      aria-label="返回顶部"
      aria-hidden={!visible}
      inert={!visible}
      data-visible={visible}
      title="返回顶部"
      className="pointer-events-none fixed right-[calc(1rem+env(safe-area-inset-right))] bottom-[calc(1rem+max(env(safe-area-inset-bottom),var(--page-bottom-occlusion,0px)))] z-30 size-12 translate-y-2 scale-95 rounded-full opacity-0 shadow-lg transition-[opacity,translate,scale,background-color] duration-250 ease-out data-[visible=true]:pointer-events-auto data-[visible=true]:translate-y-0 data-[visible=true]:scale-100 data-[visible=true]:opacity-100 motion-reduce:translate-none motion-reduce:scale-100 motion-reduce:transition-none [&_svg]:size-5"
      onClick={() => window.scrollTo({ top: 0, behavior: "auto" })}
    >
      <ArrowUp aria-hidden="true" />
    </Button>
  );
}
