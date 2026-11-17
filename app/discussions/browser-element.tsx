import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { browserInfo } from "@/lib/ui/browser-info";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { translate } from "@/lib/i18n/core";
import { DEFAULT_UI_LOCALE, parseUiLocale, type UiLocale } from "@/lib/i18n/locale";
import { formatFeedbackError, UiFeedbackError } from "@/lib/i18n/feedback";
import { useUiLocale } from "@/lib/i18n/react";

let closeManualCopy: (() => void) | undefined;

function ManualCopy({ text, locale, onClose }: { text: string; locale: UiLocale; onClose: () => void }) {
  const t = translate.bind(null, locale);
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content className="top-1/2 left-1/2 grid w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 gap-3 rounded-md p-4">
          <Dialog.Title>{t("forum.element.manualCopy")}</Dialog.Title>
          <Dialog.Description className="text-sm text-muted">{t("forum.element.copyHint")}</Dialog.Description>
          <Label htmlFor="forum-copy-text" className="sr-only">{t("forum.element.copyText")}</Label>
          <Textarea ref={input} id="forum-copy-text" readOnly value={text} className="h-64 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { input.current?.focus(); input.current?.select(); }}>{t("forum.element.selectAll")}</Button>
            <Button type="button" onClick={onClose}>{t("core.action.close")}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

async function copyText(text: string): Promise<{ copied: boolean }> {
  if (typeof text !== "string" || !text || text.length > 32_000) {
    const locale = parseUiLocale(document.documentElement.lang) ?? DEFAULT_UI_LOCALE;
    throw new Error(translate(locale, "forum.element.copyLimit"));
  }
  try {
    await navigator.clipboard.writeText(text);
    closeManualCopy?.();
    return { copied: true };
  } catch {
    const locale = parseUiLocale(document.documentElement.lang) ?? DEFAULT_UI_LOCALE;
    closeManualCopy?.();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const close = () => {
      root.unmount();
      container.remove();
      closeManualCopy = undefined;
    };
    closeManualCopy = close;
    root.render(<ManualCopy text={text} locale={locale} onClose={close} />);
    return { copied: false };
  }
}

const elementApi = {
  copyText,
  copyBrowserInfo: async () => copyText(await browserInfo()),
};

export function BrowserElement({ source, interactive = true }: { source: string; interactive?: boolean }) {
  const locale = useUiLocale();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element || !interactive) return;
    // Only server-authorized, persisted forum elements reach this path. Their
    // code is trusted site code and intentionally runs in the main document.
    Object.assign(window, { viprpg: elementApi });
    const template = document.createElement("template");
    template.innerHTML = source;
    element.replaceChildren(template.content.cloneNode(true));
    let disposed = false;

    async function runScripts() {
      // innerHTML leaves scripts inert. Fresh script nodes execute natively,
      // with document.currentScript and the site's real DOM/browser context.
      for (const original of element!.querySelectorAll("script")) {
        if (disposed) return;
        if (!original.isConnected) continue;
        const script = document.createElement("script");
        for (const attribute of original.attributes) script.setAttribute(attribute.name, attribute.value);
        script.textContent = original.textContent;
        script.async = original.hasAttribute("async");
        const type = script.type.trim().toLowerCase();
        const classic = !type || /^(?:text|application)\/(?:x-)?(?:javascript|ecmascript)$/.test(type);
        const skipped = script.noModule && "noModule" in HTMLScriptElement.prototype;
        const loaded = !skipped && !script.async && (type === "module" || (script.src && classic))
          ? new Promise<void>((resolve, reject) => {
              script.onload = () => resolve();
              script.onerror = () => reject(new UiFeedbackError("forum.element.scriptFailed"));
            })
          : null;
        original.replaceWith(script);
        if (loaded) await loaded;
      }
    }
    void runScripts().then(
      () => { if (!disposed) setError(null); },
      (reason) => { if (!disposed) setError(reason instanceof Error ? reason : new UiFeedbackError("forum.element.loadFailed")); },
    );
    return () => {
      disposed = true;
      element.dispatchEvent(new Event("dispose"));
      element.replaceChildren();
    };
  }, [source, interactive]);

  if (!interactive)
    return <pre className="my-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border p-3 font-mono text-xs">{source}</pre>;
  return (
    <div className="my-2 grid min-w-0 gap-2 whitespace-normal">
      <div ref={host} data-forum-browser-element />
      {error ? <p role="alert" className="text-sm text-destructive">{formatFeedbackError(error, locale, "")}</p> : null}
    </div>
  );
}
