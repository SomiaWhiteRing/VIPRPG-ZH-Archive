import { useEffect, useRef, useState } from "react";
import { ImagePlus, Send } from "lucide-react";
import { BodyEditor, type BodyEditorHandle } from "@/app/components/comments/body-editor";
import { EmojiPicker } from "@/app/components/emojis/picker";
import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { createImageProcessor } from "@/app/discussions/image-processor";
import { MESSAGE_BODY_LENGTH, MESSAGE_IMAGE_BYTES } from "@/lib/messages";
import { bodyLength } from "@/lib/face-emojis";
import { randomUuid } from "@/lib/browser/random-uuid";
import { requestJson } from "@/lib/ui/api-response";

export function MessageComposer({ peerId, lastMessageId, onSent }: { peerId: number; lastMessageId: number; onSent: () => Promise<void> }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const composing = useRef(false);
  const editor = useRef<BodyEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef<{ body: string; clientId: string } | null>(null);
  const pendingImage = useRef<{ source: File; image: File; clientId: string; messageId?: number } | null>(null);
  const processor = useRef<ReturnType<typeof createImageProcessor> | null>(null);
  const toast = useToast();
  useEffect(() => () => processor.current?.dispose(), []);

  async function sendText() {
    if (submitting.current || composing.current || !body.trim()) return;
    submitting.current = true;
    setBusy(true);
    try {
      const input = pending.current?.body === body ? pending.current : { body, clientId: randomUuid() };
      pending.current = input;
      await requestJson(`/api/messages/${peerId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      setBody("");
      pending.current = null;
      editor.current?.focus();
      await onSent().catch(() => { /* Already sent; the room/focus retries history synchronization. */ });
    } catch (error) { toast.error(error instanceof Error ? error.message : "发送失败"); }
    finally { submitting.current = false; setBusy(false); }
  }

  async function sendImage(file: File) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      let input = pendingImage.current;
      if (!input || (input.messageId !== undefined && input.messageId <= lastMessageId)
        || input.source.name !== file.name || input.source.size !== file.size
        || input.source.type !== file.type || input.source.lastModified !== file.lastModified) {
        processor.current ??= createImageProcessor();
        const image = await processor.current.process(file);
        if (!image.size || image.size > MESSAGE_IMAGE_BYTES) throw new Error("每张图片不能超过 2 MiB");
        input = { source: file, image, clientId: randomUuid() };
        pendingImage.current = input;
      }
      const form = new FormData();
      form.set("clientId", input.clientId);
      form.set("image", input.image);
      const result = await requestJson<{ message: { id: number } }>(`/api/messages/${peerId}/image`, { method: "POST", body: form });
      input.messageId = result.message.id;
      await onSent().then(() => { pendingImage.current = null; }, () => {
        // Keep the identity for retries until the acknowledged image appears in history.
      });
    } catch (error) { toast.error(error instanceof Error ? error.message : "图片发送失败"); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <form className="shrink-0 border-t border-border p-3" onSubmit={event => { event.preventDefault(); void sendText(); }}
    onPaste={event => { const image = [...event.clipboardData.files].find(file => file.type.startsWith("image/")); if (image) { event.preventDefault(); void sendImage(image); } }}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file.type.startsWith("image/")) void sendImage(file); } }}>
    <div onKeyDownCapture={event => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !composing.current) {
        event.preventDefault(); event.stopPropagation(); void sendText();
      }
    }}>
      <BodyEditor ref={editor} body={body} images={[]} busy={busy} topic={false} textOnly allowMentions={false}
        maxLength={MESSAGE_BODY_LENGTH} inputId="private-message-body" inputLabel="短信正文"
        onChange={value => setBody(value)} onBusyChange={setBusy} onError={message => { if (message) toast.error(message); }}
        onCompositionChange={value => { composing.current = value; }} />
    </div>
    <div className="mt-2 flex items-center gap-2">
      <EmojiPicker disabled={busy} onSelect={(emoji, options) => editor.current?.insertEmoji(emoji, options)}>{trigger => trigger}</EmojiPicker>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" aria-label="发送图片"
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void sendImage(file); }} />
      <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label="发送图片" onClick={() => fileInput.current?.click()}><ImagePlus aria-hidden /></Button>
      <Button className="ml-auto" type="submit" disabled={busy || !body.trim() || bodyLength(body) > MESSAGE_BODY_LENGTH}><Send aria-hidden />发送</Button>
    </div>
  </form>;
}
