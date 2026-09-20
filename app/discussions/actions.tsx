import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { SelectField } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import type { ForumAction, ForumTarget } from "@/lib/forum";
import { FORUM_REPORT_REASONS } from "@/lib/forum";
import { Ellipsis } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { ForumTagEditor, forumRequest } from "./shared";
export type ForumMenuItem = {
  label: string;
  run: () => void;
  danger?: boolean;
};
export function ForumMenu({ items }: { items: ForumMenuItem[] }) {
  if (!items.length) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          className="size-10"
          type="button"
          size="icon"
          variant="ghost"
          aria-label="更多操作"
          title="更多操作"
        >
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-36 rounded-md border border-border bg-card p-1 shadow-surface"
          align="end"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              className={`cursor-pointer data-[disabled]:cursor-not-allowed rounded-sm px-3 py-2 text-sm outline-none focus:bg-primary/10 ${item.danger ? "text-destructive" : ""}`}
              key={item.label}
              onSelect={item.run}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
export type ForumDialogAction = {
  kind: "report" | "delete" | "moderate";
  target: ForumTarget;
  summary: string;
  topicRevision: string;
  action?: ForumAction;
  tags?: string[];
  request?: boolean;
};
export function ForumActionDialog({
  action,
  onClose,
  onSuccess,
}: {
  action: ForumDialogAction;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState(
      action.request ? "其他" : (FORUM_REPORT_REASONS[0] as string),
    ),
    [text, setText] = useState(""),
    [tags, setTags] = useState(action.tags ?? []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const title =
    action.kind === "report"
      ? action.request
        ? "请求处理"
        : "举报"
      : action.kind === "delete"
        ? "删除内容"
        : ({
            hide: "隐藏内容",
            restore: "恢复内容",
            lock: "锁定主题",
            unlock: "解锁主题",
            feature: "加精主题",
            unfeature: "取消加精",
            pin: "置顶主题",
            unpin: "取消置顶",
            tags: "调整主题 TAG",
          }[action.action!] ?? "确认管理操作");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await forumRequest("/api/discussions", {
        op: action.kind,
        target: action.target,
        topicRevision: action.topicRevision,
        ...(action.kind === "report"
          ? { reason, explanation: text }
          : { reason: text, action: action.action, tags }),
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog
      open
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <AlertDialogContent className="rounded-md">
        <AlertDialogTitle className="text-lg font-bold">
          {title}
        </AlertDialogTitle>
        <AlertDialogDescription className="break-words text-sm text-muted">
          {action.summary}
        </AlertDialogDescription>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {action.kind === "report" ? (
            <div>
              <Label htmlFor="forum-report-reason">原因</Label>
              <SelectField
                id="forum-report-reason"
                value={reason}
                disabled={busy}
                onValueChange={setReason}
                options={FORUM_REPORT_REASONS.map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </div>
          ) : null}
          {action.action === "tags" ? (
            <ForumTagEditor
              id="forum-action-tags"
              values={tags}
              onChange={setTags}
              disabled={busy}
            />
          ) : null}
          {action.kind !== "delete" ? (
            <div>
              <Label htmlFor="forum-action-reason">
                {action.kind === "report" ? "说明" : "管理原因"}
              </Label>
              <Textarea
                id="forum-action-reason"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={action.kind === "report" ? 2000 : 1000}
                required={action.kind === "moderate" || reason === "其他"}
                disabled={busy}
              />
            </div>
          ) : (
            <p className="text-sm">删除后不能恢复。</p>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline" disabled={busy}>
                取消
              </Button>
            </AlertDialogCancel>
            <Button
              type="submit"
              disabled={busy}
              variant={
                action.kind === "delete" || action.action === "hide"
                  ? "destructive"
                  : "default"
              }
            >
              {busy ? "正在提交…" : "确认"}
            </Button>
          </div>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
