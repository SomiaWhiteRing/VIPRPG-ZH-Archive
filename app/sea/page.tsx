import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { data, useLoaderData, useRouteLoaderData, type HeadersFunction, type LinksFunction, type LoaderFunctionArgs } from "react-router";
import type { loader as rootLoader } from "@/app/root";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { RpgDialogue, RpgFace } from "@/app/components/ui/rpg-dialogue";
import { layoutSeaDialogue, limitSeaBodyInput, SEA_ASSETS, seaBitmap } from "@/lib/ui/eternal-sea";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { getUserAvatarSrc } from "@/lib/user-profile";
import { runtimeContext } from "@/app/.server/router-context";
import { prepareSeaActor } from "@/app/.server/sea/identity";
import { seaRoom } from "@/app/.server/sea/service";
import { useSeaRoom } from "@/app/components/sea/use-sea-room";
import { loadSeaFont } from "@/app/components/sea/font";
import { useToast } from "@/app/components/ui/toast";
import { HttpError } from "@/lib/http";
import type { SeaSubmission } from "@/lib/dto/sea";
import { requestJson } from "@/lib/ui/api-response";
import { useClientEnvironment } from "@/app/components/use-client-environment";
import "./sea.css";

export const meta = () => pageMetaDescriptors({ title: "永恒之海", description: "海边的几句话。" });
export const links: LinksFunction = () => [
  { rel: "preload", as: "image", href: `${SEA_ASSETS}/ocean.gif`, media: "(prefers-reduced-motion: no-preference)", fetchPriority: "high" },
  { rel: "preload", as: "image", href: `${SEA_ASSETS}/ocean.png`, media: "(prefers-reduced-motion: reduce)", fetchPriority: "high" },
];

export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  let cookie: string | undefined;
  try { cookie = (await prepareSeaActor(runtime)).cookie; }
  catch (error) { if (!(error instanceof HttpError) || error.status !== 401) throw error; }
  return data(await seaRoom(runtime).snapshot(), { headers: cookie ? { "Set-Cookie": cookie } : undefined });
}
export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers(loaderHeaders);
  headers.set("Cache-Control", "private, no-store");
  return headers;
};
export default function EternalSeaPage() {
  const environment = useClientEnvironment();
  const native = environment === "android";
  const session = useRouteLoaderData<typeof rootLoader>("root")?.session;
  const accountAvatar = session ? getUserAvatarSrc(session.avatarBlobSha256) : undefined;
  const [useOwnAvatar, setUseOwnAvatar] = useState(true);
  const name = useOwnAvatar && session ? session.displayName : "无名的VIPPER";
  const avatarUrl = useOwnAvatar ? accountAvatar : undefined;
  const { messages, font, refresh } = useSeaRoom(useLoaderData<typeof loader>());
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [composerReady, setComposerReady] = useState(false);
  const [dialoguesStarted, setDialoguesStarted] = useState(false);
  const [roomReady, setRoomReady] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followingRef = useRef(true);
  const scrollInitializedRef = useRef(false);
  const composingRef = useRef(false);
  const sendingRef = useRef(false);
  const submissionRef = useRef<SeaSubmission | null>(null);
  const layout = layoutSeaDialogue(name, draft);
  const canSend = draft.trim().length > 0 && layout.fits;

  useEffect(() => {
    let active = true;
    let frame = 0;
    const ocean = matchMedia("(prefers-reduced-motion: reduce)").matches ? "ocean.png" : "ocean.gif";
    void seaBitmap(`${SEA_ASSETS}/${ocean}`).then(image => image.decode()).catch(() => undefined).then(() => {
      if (!active) return;
      // Give the ocean a paint before mounting the rest of the interface.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => { if (active) setBackgroundReady(true); });
      });
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    if (!backgroundReady || composerReady) return;
    let active = true;
    let frame = 0;
    const images = [`${SEA_ASSETS}/window.png`, `${SEA_ASSETS}/faces.png`, ...(accountAvatar ? [accountAvatar] : [])];
    void Promise.allSettled(images.map(url => seaBitmap(url).then(image => image.decode()))).then(() => document.fonts.ready).then(() => {
      if (!active) return;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => { if (active) setComposerReady(true); });
      });
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [backgroundReady, composerReady, accountAvatar]);

  useEffect(() => {
    if (!composerReady) return;
    // Paint the usable composer before mounting and loading the dialogue list.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setDialoguesStarted(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [composerReady]);

  useEffect(() => {
    if (!dialoguesStarted || roomReady) return;
    let active = true;
    let frame = 0;
    const images = new Set([
      ...["window.png", "faces.png"].map(file => `${SEA_ASSETS}/${file}`),
      ...messages.flatMap(message => message.avatarUrl ? [message.avatarUrl] : []),
      ...(accountAvatar ? [accountAvatar] : []),
    ]);
    void Promise.all([
      Promise.allSettled([...images].map(url => seaBitmap(url).then(image => image.decode()))),
      loadSeaFont(font),
    ]).then(() => document.fonts.ready).then(() => {
      if (!active) return;
      // Dialogue effects draw while hidden; allow fallback state and initial
      // scrolling to settle before revealing the complete room in one frame.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => { if (active) setRoomReady(true); });
      });
    }).catch(() => undefined);
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [dialoguesStarted, roomReady, messages, font, accountAvatar]);

  useLayoutEffect(() => {
    if (environment === null) return;
    const scroller = environment === "android" ? document.scrollingElement : logRef.current;
    if (!scroller || (scrollInitializedRef.current && !followingRef.current)) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
    if (scrollInitializedRef.current) return;
    // Finish initial positioning after the router restores document scroll.
    const frame = requestAnimationFrame(() => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
      followingRef.current = true;
      scrollInitializedRef.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, environment, dialoguesStarted, roomReady]);

  useEffect(() => {
    if (!native) return;
    function trackDocumentScroll() {
      if (!scrollInitializedRef.current) return;
      const scroller = document.scrollingElement;
      if (scroller) followingRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 32;
    }
    window.addEventListener("scroll", trackDocumentScroll, { passive: true });
    return () => window.removeEventListener("scroll", trackDocumentScroll);
  }, [native]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canSend || composingRef.current || sendingRef.current) return;
    const avatarMode = accountAvatar && useOwnAvatar ? "own" : "alex";
    const old = submissionRef.current;
    const submission: SeaSubmission = old?.body === draft && old.avatarMode === avatarMode
      ? old : { clientMessageId: crypto.randomUUID(), body: draft, avatarMode };
    submissionRef.current = submission;
    sendingRef.current = true;
    setSending(true);
    try {
      await requestJson("/api/sea/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission) }, "发言失败");
      followingRef.current = true;
      await refresh();
      submissionRef.current = null;
      setDraft(current => current === submission.body ? "" : current);
      inputRef.current?.focus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发言失败，请稍后再试");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <main className="eternal-sea-page" data-scroll={native ? "document" : "log"} aria-label="永恒之海">
      <h1 className="sr-only">永恒之海</h1>
      {backgroundReady && <div className="sea-room">
        <div className="sea-composer-dock" inert={!composerReady}>
          <form className="sea-composer" onSubmit={send}>
            <div className="sea-compose-fields">
              {accountAvatar ? (
                <Button type="button" variant="ghost" className="sea-face-button"
                  aria-label={useOwnAvatar ? "使用亚历克斯头像" : "使用自己的头像"}
                  onClick={() => setUseOwnAvatar((current) => !current)}>
                  <RpgFace index={0} avatarUrl={avatarUrl} />
                </Button>
              ) : (
                <span className="sea-face-button"><RpgFace index={0} /></span>
              )}
              <div className="sea-input-area">
                <Label htmlFor="sea-input" className="sr-only">发言内容</Label>
                <Textarea id="sea-input" ref={inputRef} value={draft} rows={3} className="sea-input" placeholder="把握"
                  onChange={(event) => setDraft(composingRef.current ? event.target.value : limitSeaBodyInput(event.target.value))}
                  onCompositionStart={() => { composingRef.current = true; }}
                  onCompositionEnd={(event) => {
                    composingRef.current = false;
                    setDraft(limitSeaBodyInput(event.currentTarget.value));
                  }} />
                <div className="sea-submit-row">
                  <Button type="submit" variant="rm2k" size="sm" className="sea-submit" disabled={!canSend || sending}>发言</Button>
                </div>
              </div>
            </div>
          </form>
        </div>
        {dialoguesStarted && <div className="sea-log" inert={!roomReady} role="log" aria-label="海边的对话" aria-live="polite" aria-relevant="additions" ref={logRef}
          onScroll={() => {
            const log = logRef.current;
            if (!native && scrollInitializedRef.current && log) followingRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
          }}>
          <div className="sea-messages">
            {messages.map(message => <RpgDialogue key={message.id} {...message} font={font} />)}
          </div>
        </div>}
      </div>}
    </main>
  );
}
