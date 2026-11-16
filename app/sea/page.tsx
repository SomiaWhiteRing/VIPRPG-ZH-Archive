import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { data, useLoaderData, useRouteLoaderData, type HeadersFunction, type LinksFunction, type LoaderFunctionArgs } from "react-router";
import { Settings } from "lucide-react";
import type { loader as rootLoader } from "@/app/root";
import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { CharacterAvatarPicker, type CharacterAvatarSelection } from "@/app/components/ui/character-avatar-picker";
import { Input } from "@/app/components/ui/input";
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
import { SEA_ANONYMOUS_NAME, SEA_ANONYMOUS_NAME_LIMIT, SEA_FACE_COUNT, type SeaSubmission } from "@/lib/dto/sea";
import { requestJson } from "@/lib/ui/api-response";
import { useClientEnvironment } from "@/app/components/use-client-environment";
import type { PageLayoutHandle } from "@/app/components/use-page-layout";
import "./sea.css";

const SEA_NAME_KEY = "viprpg:sea:anonymous-name";
const SEA_FACE_KEY = "viprpg:sea:anonymous-face";
const SEA_PORTRAIT_KEY = "viprpg:sea:anonymous-portrait";

export const handle = {
  layout: { hideBackToTop: true, hideSiteHeader: true, hideSiteFooter: true },
} satisfies PageLayoutHandle;

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
  const [anonymousName, setAnonymousName] = useState("");
  const [anonymousFace, setAnonymousFace] = useState(0);
  const [anonymousPortrait, setAnonymousPortrait] = useState<CharacterAvatarSelection>();
  const [settings, setSettings] = useState<{ open: boolean; name: string; face: number; portrait?: CharacterAvatarSelection }>({ open: false, name: "", face: 0 });
  const avatarMode = session && useOwnAvatar ? "own" : "alex";
  const name = avatarMode === "own" && session ? session.displayName : anonymousName || SEA_ANONYMOUS_NAME;
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
    try {
      const name = localStorage.getItem(SEA_NAME_KEY);
      if (name) setAnonymousName(name.slice(0, SEA_ANONYMOUS_NAME_LIMIT));
      const face = Number(localStorage.getItem(SEA_FACE_KEY));
      if (Number.isInteger(face) && face >= 0 && face < SEA_FACE_COUNT) setAnonymousFace(face);
      const portrait = localStorage.getItem(SEA_PORTRAIT_KEY);
      if (portrait) setAnonymousPortrait(JSON.parse(portrait) as CharacterAvatarSelection);
    } catch {
      // The settings still work for this page when browser storage is unavailable.
    }
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
      ...messages.flatMap(message => message.portrait ? [`/api/media/blobs/${message.portrait.blobSha256}`]
        : message.avatarUrl ? [message.avatarUrl] : []),
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
    const savedName = avatarMode === "alex" ? anonymousName || undefined : undefined;
    const faceIndex = avatarMode === "alex" ? anonymousFace || undefined : undefined;
    const portrait = avatarMode === "alex" && anonymousPortrait
      ? { faceSheetId: anonymousPortrait.faceSheetId, row: anonymousPortrait.row, column: anonymousPortrait.column }
      : undefined;
    const old = submissionRef.current;
    const submission: SeaSubmission = old?.body === draft && old.avatarMode === avatarMode
      && old.anonymousName === savedName && old.faceIndex === faceIndex
      && old.portrait?.faceSheetId === portrait?.faceSheetId && old.portrait?.row === portrait?.row && old.portrait?.column === portrait?.column
      ? old : { clientMessageId: crypto.randomUUID(), body: draft, avatarMode, anonymousName: savedName, faceIndex, portrait };
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
              {session ? (
                <Button type="button" variant="ghost" className="sea-face-button"
                  aria-label={useOwnAvatar ? "以匿名身份发言" : "以账号身份发言"}
                  onClick={() => setUseOwnAvatar((current) => !current)}>
                  <RpgFace index={useOwnAvatar ? 0 : anonymousFace}
                    avatarUrl={useOwnAvatar ? accountAvatar : undefined}
                    portrait={useOwnAvatar ? undefined : anonymousPortrait} />
                </Button>
              ) : (
                <span className="sea-face-button"><RpgFace index={anonymousFace} portrait={anonymousPortrait} /></span>
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
                  {avatarMode === "alex" && <Dialog.Root open={settings.open} onOpenChange={(open) => setSettings({ open, name: anonymousName, face: anonymousFace, portrait: anonymousPortrait })}>
                    <Dialog.Trigger asChild>
                      <Button type="button" variant="rm2k" size="sm" className="sea-settings-trigger" aria-label="发言设置">
                        <Settings aria-hidden="true" />
                      </Button>
                    </Dialog.Trigger>
                    <Dialog.Portal>
                      <Dialog.Overlay />
                      <Dialog.Content
                        className="left-1/2 top-1/2 max-h-[calc(100dvh-2rem)] w-[min(23rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl"
                        aria-describedby={undefined}>
                        <header className="border-b border-border px-5 py-4">
                          <Dialog.Title>匿名发言设置</Dialog.Title>
                        </header>
                        <div className="grid gap-4 px-5 py-5">
                          <div className="flex items-center gap-3">
                            <span className="size-12 shrink-0 overflow-hidden rounded-md">
                              <RpgFace index={settings.face} portrait={settings.portrait} />
                            </span>
                            <CharacterAvatarPicker disabled={false} shape="square" sourceEndpoint="/api/sea/portraits" initialPortrait={settings.portrait ?? null} onSave={async portrait => {
                              setSettings(current => ({ ...current, portrait }));
                              return true;
                            }} />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="sea-anonymous-name">匿名名称</Label>
                            <Input id="sea-anonymous-name" className="text-base" maxLength={SEA_ANONYMOUS_NAME_LIMIT} value={settings.name}
                              placeholder={SEA_ANONYMOUS_NAME} onChange={event => {
                                const name = event.target.value;
                                setSettings(current => ({ ...current, name }));
                              }} />
                          </div>
                        </div>
                        <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">
                          <Button type="button" variant="ghost" className="mr-auto" onClick={() => {
                            setSettings({ open: true, name: "", face: 0 });
                          }}>重置</Button>
                          <Dialog.Close asChild><Button type="button" variant="ghost">取消</Button></Dialog.Close>
                          <Button type="button" onClick={() => {
                            const name = settings.name.trim();
                            setAnonymousName(name);
                            setAnonymousFace(settings.face);
                            setAnonymousPortrait(settings.portrait);
                            setSettings({ ...settings, open: false });
                            try {
                              if (name) localStorage.setItem(SEA_NAME_KEY, name);
                              else localStorage.removeItem(SEA_NAME_KEY);
                              if (!settings.face) localStorage.removeItem(SEA_FACE_KEY);
                              if (settings.portrait) localStorage.setItem(SEA_PORTRAIT_KEY, JSON.stringify(settings.portrait));
                              else localStorage.removeItem(SEA_PORTRAIT_KEY);
                            } catch {
                              // Keep the in-memory selection when browser storage is unavailable.
                            }
                          }}>保存</Button>
                        </footer>
                      </Dialog.Content>
                    </Dialog.Portal>
                  </Dialog.Root>}
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
