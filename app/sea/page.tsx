import { translate, type MessageKey } from "@/lib/i18n/core";
import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useUiLocale } from "@/lib/i18n/react";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { data, useLoaderData, useRouteLoaderData, type HeadersFunction, type LinksFunction, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { Settings } from "lucide-react";
import type { loader as rootLoader } from "@/app/root";
import { Button } from "@/app/components/ui/button";
import * as Dialog from "@/app/components/ui/dialog";
import { CharacterAvatarPicker, type CharacterAvatarSelection } from "@/app/components/ui/character-avatar-picker";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { RpgDialogue, RpgFace } from "@/app/components/ui/rpg-dialogue";
import { layoutSeaBody, limitSeaBodyInput, SEA_ASSETS, seaBitmap, seaBodyByteBudget } from "@/lib/ui/eternal-sea";
import { pageMetaDescriptors, pageMetadataLocale } from "@/lib/ui/page-metadata";
import { getUserAvatarSrc } from "@/lib/user-profile";
import { runtimeContext } from "@/app/.server/router-context";
import { prepareSeaActor } from "@/app/.server/sea/identity";
import { seaRoom } from "@/app/.server/sea/service";
import { useSeaRoom } from "@/app/components/sea/use-sea-room";
import { loadSeaFont } from "@/app/components/sea/font";
import { useToast } from "@/app/components/ui/toast";
import { HttpError } from "@/lib/http";
import { SEA_ANONYMOUS_NAME, SEA_ANONYMOUS_NAME_LIMIT, SEA_FACE_COUNT, type SeaSubmission } from "@/lib/dto/sea";
import { ApiResponseError, requestJson } from "@/lib/ui/api-response";
import { useClientEnvironment } from "@/app/components/use-client-environment";
import type { PageLayoutHandle } from "@/app/components/use-page-layout";
import "./sea.css";

const sendErrorKeys: Readonly<Record<string, MessageKey>> = {
  sea_request_conflict: "sea.conflict",
  sea_muted: "sea.muted",
  sea_rate_limited: "sea.rate",
};

const SEA_NAME_KEY = "viprpg:sea:anonymous-name";
const SEA_FACE_KEY = "viprpg:sea:anonymous-face";
const SEA_PORTRAIT_KEY = "viprpg:sea:anonymous-portrait";

export const handle = {
  layout: { hideBackToTop: true, hideSiteHeader: true, hideSiteFooter: true },
} satisfies PageLayoutHandle;

export const meta: MetaFunction<typeof loader> = ({ loaderData, error, location, matches }) => {
  const locale = loaderData?.locale ?? pageMetadataLocale(location.search, matches);
  return pageMetaDescriptors({ title: translate(locale, "sea.title"), description: translate(locale, "sea.description") }, error, locale);
};
export const links: LinksFunction = () => [
  { rel: "preload", as: "image", href: `${SEA_ASSETS}/ocean.gif`, media: "(prefers-reduced-motion: no-preference)", fetchPriority: "high" },
  { rel: "preload", as: "image", href: `${SEA_ASSETS}/ocean.png`, media: "(prefers-reduced-motion: reduce)", fetchPriority: "high" },
];

export async function loader({ context }: LoaderFunctionArgs) {
  const runtime = context.get(runtimeContext);
  let cookie: string | undefined;
  try { cookie = (await prepareSeaActor(runtime)).cookie; }
  catch (error) { if (!(error instanceof HttpError) || error.status !== 401) throw error; }
  return data({ ...await seaRoom(runtime).snapshot(), locale: runtime.uiLocale }, { headers: cookie ? { "Set-Cookie": cookie } : undefined });
}
export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers(loaderHeaders);
  headers.set("Cache-Control", "private, no-store");
  return headers;
};
export default function EternalSeaPage() {
  const t = useMessages();
  const locale = useUiLocale();
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
  const submissionFields = {
    avatarMode,
    anonymousName: avatarMode === "alex" ? anonymousName || undefined : undefined,
    faceIndex: avatarMode === "alex" ? anonymousFace || undefined : undefined,
    portrait: avatarMode === "alex" && anonymousPortrait
      ? { faceSheetId: anonymousPortrait.faceSheetId, row: anonymousPortrait.row, column: anonymousPortrait.column }
      : undefined,
  } satisfies Omit<SeaSubmission, "clientMessageId" | "body">;
  const { messages, font, refresh } = useSeaRoom(useLoaderData<typeof loader>(), locale);
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [composerReady, setComposerReady] = useState(false);
  const [dialoguesStarted, setDialoguesStarted] = useState(false);
  const [roomReady, setRoomReady] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const followingRef = useRef(true);
  const scrollInitializedRef = useRef(false);
  const composingRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const submissionRef = useRef<SeaSubmission | null>(null);
  const byteBudget = seaBodyByteBudget(submissionFields);
  const layout = layoutSeaBody(draft, byteBudget);
  const canSend = layout.hasContent && layout.fits;

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

  function commitDraft(input: HTMLTextAreaElement, previous: string) {
    const { value, selectionEnd } = input;
    const next = limitSeaBodyInput(value, selectionEnd, previous, byteBudget);
    if (next !== value) {
      const caret = Math.max(0, selectionEnd + next.length - value.length);
      input.value = next;
      input.setSelectionRange(caret, caret);
    }
    setDraft(next);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canSend || composingRef.current !== null || sendingRef.current) return;
    const { anonymousName: savedName, faceIndex, portrait } = submissionFields;
    const old = submissionRef.current;
    const submission: SeaSubmission = old?.body === draft && old.avatarMode === avatarMode
      && old.anonymousName === savedName && old.faceIndex === faceIndex
      && old.portrait?.faceSheetId === portrait?.faceSheetId && old.portrait?.row === portrait?.row && old.portrait?.column === portrait?.column
      ? old : { ...submissionFields, clientMessageId: crypto.randomUUID(), body: draft };
    submissionRef.current = submission;
    sendingRef.current = true;
    setSending(true);
    try {
      await requestJson(`/api/sea/messages?${UI_LOCALE_PARAM}=${locale}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission) }, t("sea.sendFailed"));
      followingRef.current = true;
      await refresh();
      submissionRef.current = null;
      setDraft(current => current === submission.body ? "" : current);
      inputRef.current?.focus();
    } catch (error) {
      const key = error instanceof ApiResponseError && error.code && Object.hasOwn(sendErrorKeys, error.code)
        ? sendErrorKeys[error.code] : undefined;
      toast.error(key ? t(key) : error instanceof ApiResponseError ? error.messageFor(locale) : error instanceof Error ? error.message : t("sea.sendFailed"));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <main className="eternal-sea-page" data-scroll={native ? "document" : "log"} aria-label={t("sea.title")}>
      <h1 className="sr-only">{t("sea.title")}</h1>
      {backgroundReady && <div className="sea-room">
        <div className="sea-composer-dock" inert={!composerReady}>
          <form className="sea-composer" onSubmit={send}>
            <div className="sea-compose-fields">
              {session ? (
                <Button type="button" variant="ghost" className="sea-face-button"
                  aria-label={useOwnAvatar ? t("sea.anonymous") : t("sea.account")}
                  onClick={() => setUseOwnAvatar((current) => !current)}>
                  <RpgFace index={useOwnAvatar ? 0 : anonymousFace}
                    avatarUrl={useOwnAvatar ? accountAvatar : undefined}
                    portrait={useOwnAvatar ? undefined : anonymousPortrait} />
                </Button>
              ) : (
                <span className="sea-face-button"><RpgFace index={anonymousFace} portrait={anonymousPortrait} /></span>
              )}
              <div className="sea-input-area">
                <Label htmlFor="sea-input" className="sr-only">{t("sea.body")}</Label>
                <Textarea id="sea-input" ref={inputRef} value={draft} rows={3} className="sea-input" placeholder={t("sea.placeholder")}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
                      || event.nativeEvent.isComposing || event.keyCode === 229 || composingRef.current !== null) return;
                    event.preventDefault();
                    if (!event.repeat) submitRef.current?.click();
                  }}
                  onChange={(event) => {
                    if (composingRef.current !== null) setDraft(event.currentTarget.value);
                    else commitDraft(event.currentTarget, draft);
                  }}
                  onCompositionStart={() => { composingRef.current = draft; }}
                  onCompositionEnd={(event) => {
                    const previous = composingRef.current ?? draft;
                    composingRef.current = null;
                    commitDraft(event.currentTarget, previous);
                  }} />
                <div className="sea-submit-row">
                  {avatarMode === "alex" && <Dialog.Root open={settings.open} onOpenChange={(open) => setSettings({ open, name: anonymousName, face: anonymousFace, portrait: anonymousPortrait })}>
                    <Dialog.Trigger asChild>
                      <Button type="button" variant="rm2k" size="sm" className="sea-settings-trigger" aria-label={t("sea.settings")}>
                        <Settings aria-hidden="true" />
                      </Button>
                    </Dialog.Trigger>
                    <Dialog.Portal>
                      <Dialog.Overlay />
                      <Dialog.Content
                        className="left-1/2 top-1/2 max-h-[calc(100dvh-2rem)] w-[min(23rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl"
                        aria-describedby={undefined}>
                        <header className="border-b border-border px-5 py-4">
                          <Dialog.Title>{t("sea.anonymousSettings")}</Dialog.Title>
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
                            <Label htmlFor="sea-anonymous-name">{t("sea.name")}</Label>
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
                          }}>{t("upload.cover.reset")}</Button>
                          <Dialog.Close asChild><Button type="button" variant="ghost">{t("play.save.cancel")}</Button></Dialog.Close>
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
                          }}>{t("core.action.save")}</Button>
                        </footer>
                      </Dialog.Content>
                    </Dialog.Portal>
                  </Dialog.Root>}
                  <Button ref={submitRef} type="submit" variant="rm2k" size="sm" className="sea-submit"
                    aria-keyshortcuts="Control+Enter" disabled={!canSend || sending}>{t("sea.send")}</Button>
                </div>
              </div>
            </div>
          </form>
        </div>
        {dialoguesStarted && <div className="sea-log" inert={!roomReady} role="log" aria-label={t("sea.log")} aria-live="polite" aria-relevant="additions" ref={logRef}
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
