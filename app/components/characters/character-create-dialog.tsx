import { Button } from "@/app/components/ui/button";
import { useToast } from "@/app/components/ui/toast";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { normalizeEntityName } from "@/lib/entity-name";
import * as Dialog from "@/app/components/ui/dialog";
import { type FormEvent, type ReactNode, useId, useState } from "react";


export type CharacterNameInput = {
  originalName: string;
  displayName: string;
};

export function CharacterCreateDialog({
  description,
  initialOriginalName = "",
  onCreate,
  onOpenChange,
  open,
  returnFocus,
  submitLabel,
  submittingLabel,
  title,
}: {
  description: ReactNode;
  initialOriginalName?: string;
  onCreate: (input: CharacterNameInput) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  returnFocus?: () => HTMLElement | null;
  submitLabel: string;
  submittingLabel: string;
  title: string;
}) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      {open ? (
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content
            className="left-1/2 top-1/2 grid max-h-[calc(100vh-2rem)] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg p-5"
            onCloseAutoFocus={
              returnFocus
                ? (event) => {
                    event.preventDefault();
                    returnFocus()?.focus();
                  }
                : undefined
            }
          >
            <Dialog.Title>
              {title}
            </Dialog.Title>
            <Dialog.Description className="m-0 text-sm leading-6 text-muted">
              {description}
            </Dialog.Description>
            <CharacterCreateForm
              initialOriginalName={initialOriginalName}
              onCreate={onCreate}
              onOpenChange={onOpenChange}
              submitLabel={submitLabel}
              submittingLabel={submittingLabel}
            />
          </Dialog.Content>
        </Dialog.Portal>
      ) : null}
    </Dialog.Root>
  );
}

function CharacterCreateForm({
  initialOriginalName,
  onCreate,
  onOpenChange,
  submitLabel,
  submittingLabel,
}: {
  initialOriginalName: string;
  onCreate: (input: CharacterNameInput) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  submitLabel: string;
  submittingLabel: string;
}) {
  const fieldId = useId();
  const toast = useToast();
  const [originalName, setOriginalName] = useState(initialOriginalName);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    const normalizedOriginalName = normalizeEntityName(originalName);
    const normalizedDisplayName = normalizeEntityName(displayName);
    if (!normalizedOriginalName || !normalizedDisplayName) {
      setError("请填写日语名和中文名。");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        originalName: normalizedOriginalName,
        displayName: normalizedDisplayName,
      });
      onOpenChange(false);
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : "角色创建失败，请稍后重试。",
      );
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor={`${fieldId}-original-name`}>日语名</Label>
        <Input
          autoFocus
          disabled={submitting}
          id={`${fieldId}-original-name`}
          onChange={(event) => {
            setOriginalName(event.target.value);
            setError(null);
          }}
          required
          value={originalName}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${fieldId}-display-name`}>中文名</Label>
        <Input
          disabled={submitting}
          id={`${fieldId}-display-name`}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setError(null);
          }}
          required
          value={displayName}
        />
      </div>
      {error ? (
        <p className="m-0 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          disabled={submitting}
          onClick={() => onOpenChange(false)}
          type="button"
          variant="outline"
        >
          取消
        </Button>
        <Button disabled={submitting} type="submit">
          {submitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
