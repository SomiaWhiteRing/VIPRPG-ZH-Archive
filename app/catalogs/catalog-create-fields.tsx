import { FormField } from "@/app/components/ui/form-field";
import { Input } from "@/app/components/ui/input";
import { Notice } from "@/app/components/ui/notice";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { useToast } from "@/app/components/ui/toast";
import type { CatalogSummary } from "@/lib/dto/db/catalogs";
import { useId, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

export function CatalogCreateFields({
  busy,
  onBusyChange,
  onCancel,
  workId,
}: {
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  workId?: number;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const id = useId();
  const submitting = useRef(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [createdCatalog, setCreatedCatalog] = useState<CatalogSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || submitting.current || !title.trim()) return;
    submitting.current = true;
    onBusyChange(true);
    setMessage(null);
    let catalog = createdCatalog;
    try {
      if (!catalog) {
        const response = await fetch("/api/catalogs", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, description: description || null }),
        });
        const body = (await response.json()) as {
          ok?: boolean;
          catalog?: CatalogSummary;
          detail?: string;
        };
        if (!response.ok || !body.ok || !body.catalog) {
          toast.error(body.detail ?? "目录创建失败。");
          return;
        }
        catalog = body.catalog;
        setCreatedCatalog(catalog);
      }
      if (workId !== undefined) {
        const response = await fetch(`/api/catalogs/${catalog.id}/items`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workId }),
        });
        const body = (await response.json()) as { ok?: boolean };
        if (!response.ok || !body.ok) {
          setMessage("目录已创建，但添加游戏失败。请重试，将继续加入此目录。");
          return;
        }
      }
      toast.success(workId === undefined ? "目录已创建。" : "目录已创建并加入当前游戏。");
      navigate(`/catalogs/${catalog.id}`);
    } catch {
      if (catalog && workId !== undefined) {
        setMessage("目录已创建，但尚未确认游戏加入成功。请重试，将继续加入此目录。");
      } else {
        toast.error("网络请求失败。");
      }
    } finally {
      submitting.current = false;
      onBusyChange(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <FormField controlId={`${id}-title`} label="标题">
        <Input
          id={`${id}-title`}
          required
          disabled={busy || !!createdCatalog}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
      <FormField controlId={`${id}-description`} label="说明">
        <Textarea
          id={`${id}-description`}
          rows={3}
          disabled={busy || !!createdCatalog}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      {message ? <Notice>{message}</Notice> : null}
      <div className="flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} type="button" variant="outline">
          取消
        </Button>
        <Button disabled={busy || !title.trim()} type="submit">
          {busy
            ? workId === undefined ? "正在创建…" : "正在创建并加入…"
            : workId === undefined ? "创建目录" : "创建并加入新目录"}
        </Button>
      </div>
    </form>
  );
}
