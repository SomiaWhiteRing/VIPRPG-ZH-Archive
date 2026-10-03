import { ApiResponseError, requestJson } from "@/lib/ui/api-response";


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
        const body = await requestJson<{ ok?: boolean; catalog?: CatalogSummary }>("/api/catalogs", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, description: description || null }),
        }, "目录创建失败");
        if (!body.catalog) throw new Error("目录已创建，但服务器未返回目录资料，请刷新确认。");
        catalog = body.catalog;
        setCreatedCatalog(catalog);
      }
      if (workId !== undefined) {

        await requestJson(`/api/catalogs/${catalog.id}/items`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workId }),
        });

      }
      toast.success(workId === undefined ? "目录已创建。" : "目录已创建并加入当前游戏。");
      navigate(`/catalogs/${catalog.id}`);
    } catch (error) {
      if (catalog && workId !== undefined) {
        setMessage("目录已创建，但尚未确认游戏加入成功。请重试，将继续加入此目录。");
      } else {
        toast.error(error instanceof ApiResponseError ? error.message : "网络请求失败。");
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
