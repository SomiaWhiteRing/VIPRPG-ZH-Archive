import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/app/components/ui/alert-dialog";
import { Button } from "@/app/components/ui/button";
import { useState } from "react";

export function ImageCleanupButton({
  id,
  author,
  topicId,
  postNumber,
  retry,
}: {
  id: string;
  author: string;
  topicId: number | null;
  postNumber: number | null;
  retry: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline">
          {retry ? "重试清理" : "删除图片"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="rounded-md">
        <AlertDialogTitle className="text-lg font-bold">
          永久删除图片？
        </AlertDialogTitle>
        <AlertDialogDescription className="break-words text-sm text-muted">
          {author} ·{" "}
          {topicId ? `主题 ${topicId} · #${postNumber}` : "未关联帖子"}
          <span className="mt-1 block break-all font-mono text-xs">{id}</span>
          <span className="mt-3 block">
            图片文件将永久删除，无法恢复。关联的帖子或主题也将无法完整恢复。
          </span>
        </AlertDialogDescription>
        <form
          action="/api/admin/discussions/images"
          method="post"
          onSubmit={(event) => {
            if (busy) event.preventDefault();
            else setBusy(true);
          }}
          className="flex justify-end gap-2"
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="op" value="cleanup" />
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={busy}>
              取消
            </Button>
          </AlertDialogCancel>
          <Button type="submit" variant="destructive" disabled={busy}>
            {busy ? "正在删除…" : "确认永久删除"}
          </Button>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
