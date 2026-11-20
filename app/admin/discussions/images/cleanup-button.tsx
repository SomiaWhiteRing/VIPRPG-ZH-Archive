import { UI_LOCALE_PARAM } from "@/lib/i18n/locale";
import { useMessages, useNavigationLocale } from "@/lib/i18n/react";
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
  const t = useMessages();
  const navigationLocale = useNavigationLocale();
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
          {retry ? t("admin.discussions.imageRetry") : t("admin.discussions.imageDelete")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="rounded-md">
        <AlertDialogTitle className="text-lg font-bold">
          {t("admin.discussions.imageDeleteTitle")}
        </AlertDialogTitle>
        <AlertDialogDescription className="break-words text-sm text-muted">
          <span className="flex flex-wrap gap-x-2">
            <span>{author}</span>
            <span>{topicId ? t("admin.discussions.imagePost", { id: topicId, post: postNumber ?? "" }) : t("admin.discussions.imageUnlinked")}</span>
          </span>
          <span className="mt-1 block break-all font-mono text-xs">{id}</span>
          <span className="mt-3 block">
            {t("admin.discussions.imageDeleteNote")}
          </span>
        </AlertDialogDescription>
        <form
          action={`/api/admin/discussions/images${navigationLocale ? `?${UI_LOCALE_PARAM}=${navigationLocale}` : ""}`}
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
              {t("play.save.cancel")}
            </Button>
          </AlertDialogCancel>
          <Button type="submit" variant="destructive" disabled={busy}>
            {busy ? t("admin.discussions.imageDeleting") : t("admin.discussions.imageConfirm")}
          </Button>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
