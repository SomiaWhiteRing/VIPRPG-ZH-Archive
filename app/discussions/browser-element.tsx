import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { browserInfo } from "@/lib/ui/browser-info";
import { useEffect, useRef, useState } from "react";

const MESSAGE = "viprpg-forum-element-v1";
const TEXT_LIMIT = 32_000;

// No same-origin sandbox privilege: custom scripts cannot read the parent DOM,
// session cookies, IndexedDB, OPFS or invoke authenticated site APIs.
function elementDocument(source: string): string {
  const bridge = `<script>
    (() => {
      let sequence = 0;
      const pending = new Map();
      const request = (action, text) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('操作超时，请重试。')); }, 10000);
        pending.set(id, { resolve, reject, timer });
        parent.postMessage({ type: '${MESSAGE}', action, id, text }, '*');
      });
      window.viprpg = {
        copyText: (text) => request('copyText', text),
        copyBrowserInfo: () => request('copyBrowserInfo')
      };
      addEventListener('message', (event) => {
        if (event.source !== parent || event.data?.type !== '${MESSAGE}') return;
        const item = pending.get(event.data.id);
        if (!item) return;
        clearTimeout(item.timer);
        pending.delete(event.data.id);
        if (event.data.error) item.reject(new Error(event.data.error));
        else item.resolve({ copied: event.data.copied });
      });
      const measure = () => parent.postMessage({ type: '${MESSAGE}', action: 'resize', height: document.documentElement.scrollHeight }, '*');
      addEventListener('load', () => {
        measure();
        if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(document.body);
        if (typeof MutationObserver !== 'undefined') new MutationObserver(measure).observe(document.body, { childList: true, subtree: true, characterData: true });
      });
    })();
  </script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><style>html,body{margin:0;overflow-wrap:anywhere}body{display:flow-root}*{box-sizing:border-box}</style>${bridge}</head><body>${source}</body></html>`;
}

export function BrowserElement({ source }: { source: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const manual = useRef<HTMLTextAreaElement>(null);
  const copying = useRef(false);
  const [height, setHeight] = useState(100);
  const [text, setText] = useState("");

  useEffect(() => {
    async function receive(event: MessageEvent) {
      if (!frame.current || event.source !== frame.current.contentWindow || event.data?.type !== MESSAGE) return;
      const data = event.data;
      if (data.action === "resize") {
        if (typeof data.height === "number" && Number.isFinite(data.height))
          setHeight(Math.max(48, Math.min(1200, Math.ceil(data.height))));
        return;
      }
      if (!Number.isSafeInteger(data.id) || data.id < 1 || copying.current ||
        (data.action !== "copyText" && data.action !== "copyBrowserInfo")) return;
      const target = frame.current.contentWindow;
      const reply = (result: { copied: boolean } | { error: string }) =>
        target?.postMessage({ type: MESSAGE, id: data.id, ...result }, "*");
      // Clicks in a child frame activate its ancestor. Do not grant clipboard
      // writes to scripts running on load or via synthetic events.
      const activated = navigator.userActivation?.isActive === true;
      if (navigator.userActivation ? !activated : document.activeElement !== frame.current) {
        reply({ error: "请直接点击互动内容中的按钮后重试。" });
        return;
      }
      copying.current = true;
      try {
        const value = data.action === "copyBrowserInfo" ? await browserInfo() : data.text;
        if (typeof value !== "string" || !value || value.length > TEXT_LIMIT)
          throw new Error("复制文本必须非空且不超过 32000 个字符。");
        let copied = false;
        try {
          if (!activated) throw new Error("浏览器未提供用户激活状态，请手动复制。");
          await navigator.clipboard.writeText(value);
          copied = true;
          setText("");
        } catch {
          setText(value);
        }
        reply({ copied });
      } catch (error) {
        reply({ error: error instanceof Error ? error.message : "操作失败。" });
      } finally {
        copying.current = false;
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [source]);

  return (
    <div className="my-2 grid w-full min-w-0 gap-2 whitespace-normal">
      <iframe
        ref={frame}
        title="帖子互动内容"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={elementDocument(source)}
        height={height}
        className="block w-full border-0"
      />
      {text ? (
        <div className="grid min-w-0 gap-2 rounded-md border border-border p-3">
          <Label>浏览器未允许自动复制，请选择下面的文本并手动复制。</Label>
          <Textarea ref={manual} aria-label="待复制文本" readOnly value={text} className="h-48 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
          <Button type="button" variant="outline" className="w-fit" onClick={() => { manual.current?.focus(); manual.current?.select(); }}>选择全部文本</Button>
        </div>
      ) : null}
    </div>
  );
}
