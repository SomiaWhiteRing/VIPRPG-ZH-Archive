import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { EmojiPicker } from "@/app/components/emojis/picker";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { useToast } from "@/app/components/ui/toast";
import type { DraftImage } from "@/app/discussions/images";
import type { CommentDto } from "@/lib/dto/db/work-community";
import { BodyEditor, type BodyEditorHandle } from "./body-editor";

const NO_IMAGES: DraftImage[] = [];

export function CommentReplyEditor({
  endpoint,
  rootId,
  target,
  unavailable,
  onBusyChange,
  onCancel,
  onCreated,
}: {
  endpoint: string;
  rootId: number;
  target: CommentDto;
  unavailable: boolean;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onCreated: (reply: CommentDto) => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const editor = useRef<BodyEditorHandle>(null);
  const toast = useToast();
  const inputId = `comment-reply-input-${rootId}`;

  useEffect(() => {
    editor.current?.focus();
  }, [target.id]);

  async function submit() {
    if (pending.current || unavailable || !body.trim()) return;
    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, replyToCommentId: target.id }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        comment?: CommentDto;
        detail?: string;
      };
      if (!response.ok || !result.ok || !result.comment) {
        setError(result.detail ?? "回复发送失败。");
        return;
      }
      onCreated(result.comment);
      toast.success("回复已发布。");
    } catch {
      setError("网络请求失败，回复内容已保留，请重试。");
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <div className="mt-3 grid min-w-0 gap-2" aria-label="楼内回复">
      <div className="flex items-center gap-2 text-sm">
        <Label className="text-xs font-semibold text-muted" htmlFor={inputId}>
          回复 {target.author?.displayName ?? "已删除用户"}
        </Label>
        <Button disabled={busy} type="button" variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
      </div>
      <BodyEditor
        ref={editor}
        inputId={inputId}
        textOnly
        maxLength={2000}
        body={body}
        images={NO_IMAGES}
        busy={busy || unavailable}
        topic={false}
        autoFocus
        placeholder="写下回复……"
        onChange={setBody}
        onBusyChange={setBusy}
        onError={setError}
        onCompositionChange={() => {}}
      />
      {error || unavailable ? (
        <p role="alert" className="text-sm text-destructive">
          {unavailable ? "回复目标已删除，请取消后重新选择。" : error}
        </p>
      ) : null}
      <EmojiPicker
        disabled={busy || unavailable}
        onSelect={(emoji, options) => editor.current?.insertEmoji(emoji, options)}
        onClose={() => editor.current?.focus()}
      >
        {(trigger) => (
          <div className="flex items-center justify-between gap-3">
            {trigger}
            <Button disabled={busy || unavailable || !body.trim()} type="button" onClick={() => void submit()}>
              <Send aria-hidden />
              {busy ? "正在回复…" : "发布回复"}
            </Button>
          </div>
        )}
      </EmojiPicker>
    </div>
  );
}
