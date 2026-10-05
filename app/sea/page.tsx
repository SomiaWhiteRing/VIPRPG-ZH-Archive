import { useEffect, useRef, useState, type FormEvent } from "react";
import { data, useLoaderData, useRouteLoaderData, type HeadersFunction, type LoaderFunctionArgs } from "react-router";
import type { loader as rootLoader } from "@/app/root";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { RpgDialogue, RpgFace } from "@/app/components/ui/rpg-dialogue";
import { layoutSeaDialogue, limitSeaBodyInput } from "@/lib/ui/eternal-sea";
import { pageMetaDescriptors } from "@/lib/ui/page-metadata";
import { getUserAvatarSrc } from "@/lib/user-profile";
import { runtimeContext } from "@/app/.server/router-context";
import { prepareSeaActor } from "@/app/.server/sea/identity";
import { seaRoom } from "@/app/.server/sea/service";
import { useSeaRoom } from "@/app/components/sea/use-sea-room";
import { useToast } from "@/app/components/ui/toast";
import { HttpError } from "@/lib/http";
import type { SeaSubmission } from "@/lib/dto/sea";
import { requestJson } from "@/lib/ui/api-response";
import "./sea.css";

export const meta = () => pageMetaDescriptors({ title: "永恒之海", description: "海边的几句话。" });

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
  const session = useRouteLoaderData<typeof rootLoader>("root")?.session;
  const accountAvatar = session ? getUserAvatarSrc(session.avatarBlobSha256) : undefined;
  const [useOwnAvatar, setUseOwnAvatar] = useState(true);
  const name = useOwnAvatar && session ? session.displayName : "无名的VIPPER";
  const avatarUrl = useOwnAvatar ? accountAvatar : undefined;
  const { messages, refresh } = useSeaRoom(useLoaderData<typeof loader>());
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followingRef = useRef(true);
  const composingRef = useRef(false);
  const sendingRef = useRef(false);
  const submissionRef = useRef<SeaSubmission | null>(null);
  const layout = layoutSeaDialogue(name, draft);
  const canSend = draft.trim().length > 0 && layout.fits;

  useEffect(() => {
    if (followingRef.current && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    function copyDialogue(event: ClipboardEvent) {
      if (event.defaultPrevented || !event.clipboardData) return;
      if (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]')) return;
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!logRef.current?.contains(range.commonAncestorContainer)) return;
      const content = range.cloneContents();
      for (const dialogue of content.querySelectorAll(".sea-dialogue")) {
        dialogue.appendChild(document.createTextNode("\n"));
      }
      event.clipboardData.setData("text/plain", content.textContent ?? "");
      event.preventDefault();
    }
    document.addEventListener("copy", copyDialogue);
    return () => document.removeEventListener("copy", copyDialogue);
  }, []);

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
    <main className="eternal-sea-page" aria-label="永恒之海">
      <h1 className="sr-only">永恒之海</h1>
      <div className="sea-room">
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
        <div className="sea-log" role="log" aria-label="海边的对话" aria-live="polite" aria-relevant="additions" ref={logRef}
          onScroll={() => {
            const log = logRef.current;
            if (log) followingRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
          }}>
          <div className="sea-messages">
            {messages.map(message => <RpgDialogue key={message.id} {...message} />)}
          </div>
        </div>
      </div>
    </main>
  );
}
